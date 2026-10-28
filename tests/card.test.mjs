import test from "node:test";
import assert from "node:assert/strict";
import { calendarMidnight, co2Reading, displayEvents, normalizeEvents } from "../echo-show-card.js";

const ZONE = "Europe/Berlin";
const NOW = Date.parse("2026-10-28T12:00:00+01:00");
const MINUTE = 60_000;
const timed = (title, startMinutes, endMinutes) => ({ summary: title,
  start: { dateTime: new Date(NOW + startMinutes * MINUTE).toISOString() },
  end: { dateTime: new Date(NOW + endMinutes * MINUTE).toISOString() },
});
const allDay = (title, start = "2026-10-28", end = "2026-10-29") => ({ summary: title, start: { date: start }, end: { date: end } });
const model = (events, now = NOW) => displayEvents(normalizeEvents(events, ZONE), now);

test("CO₂ boundaries use the actual reading, including fractional values", () => {
  for (const [value, band] of [["599.9", "neutral"], ["600", "yellow"], ["1000", "yellow"], ["1000.1", "red"]]) {
    assert.deepEqual(co2Reading({ state: value, attributes: { unit_of_measurement: "ppm" } }), { band, label: `CO₂ ${value} ppm` });
  }
});

test("CO₂ missing, invalid, wrong-unit and disconnected readings are unavailable", () => {
  for (const state of [undefined, { state: "" }, { state: "  " }, { state: "unknown" }, { state: "unavailable" }, { state: "Infinity" }, { state: "-1" }, { state: "900", attributes: { unit_of_measurement: "ppb" } }]) {
    assert.deepEqual(co2Reading(state), { band: "neutral", label: "CO₂ unavailable" });
  }
  assert.equal(co2Reading({ state: "1200" }, false).band, "neutral");
});

test("countdown enters strictly below one hour, rounds up and handles the last minute", () => {
  const events = [timed("Appointment", 60, 120)];
  assert.equal(model(events).focus, null);
  assert.equal(model(events, NOW + 20_000).focus.status, "in 60 minutes");
  assert.equal(model(events, NOW + 59 * MINUTE).focus.status, "in 1 minute");
  assert.equal(model(events, NOW + 59 * MINUTE + 1).focus.status, "in less than a minute");
  assert.equal(model(events, NOW + 60 * MINUTE).focus.status, "ongoing");
  assert.equal(model(events, NOW + 120 * MINUTE).focus, null);
});

test("earliest ongoing event hides the approaching countdown and yields at its end", () => {
  const events = [timed("Next", 10, 150), timed("First", -60, 120), timed("Also ongoing", -10, 160)];
  assert.equal(model(events).focus.events[0].title, "First");
  assert.equal(model(events).focus.status, "ongoing");
  assert.equal(model(events, NOW + 120 * MINUTE).focus.events[0].title, "Also ongoing");
  assert.equal(model(events, NOW + 160 * MINUTE).focus, null);
});

test("simultaneous events share focus; each is removed at its own end", () => {
  const events = [timed("B", 10, 30), timed("A", 10, 60)];
  assert.deepEqual(model(events).focus.events.map((event) => event.title), ["A", "B"]);
  assert.deepEqual(model(events, NOW + 30 * MINUTE).focus.events.map((event) => event.title), ["A"]);
});

test("an approaching event takes focus after an ongoing event ends", () => {
  const events = [timed("Ongoing", -10, 5), timed("Next", 20, 80)];
  assert.equal(model(events, NOW + 5 * MINUTE).focus.status, "in 15 minutes");
});

test("all-day events spanning today appear in the agenda and never enter focus", () => {
  const result = model([allDay("Holiday", "2026-10-26", "2026-10-30"), allDay("Expired", "2026-10-27", "2026-10-28")]);
  assert.equal(result.focus, null);
  assert.deepEqual(result.agenda.map((event) => event.title), ["Holiday"]);
});

test("agenda is chronological, has five entries, and excludes the seven-day boundary", () => {
  const events = Array.from({ length: 8 }, (_, i) => timed(`Event ${i}`, (i + 2) * 60, (i + 3) * 60)).reverse();
  assert.deepEqual(model(events).agenda.map((event) => event.title), ["Event 0", "Event 1", "Event 2", "Event 3", "Event 4"]);
  assert.deepEqual(model([timed("Boundary", 7 * 1440, 7 * 1440 + 60), timed("Past", -120, -60)]).agenda, []);
});

test("all-day midnight uses the HA timezone and exclusive end across DST", () => {
  assert.equal(new Date(calendarMidnight("2026-03-29", ZONE)).toISOString(), "2026-03-28T23:00:00.000Z");
  assert.equal(new Date(calendarMidnight("2026-03-30", ZONE)).toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(new Date(calendarMidnight("2026-10-25", ZONE)).toISOString(), "2026-10-24T22:00:00.000Z");
  assert.equal(new Date(calendarMidnight("2026-10-26", ZONE)).toISOString(), "2026-10-25T23:00:00.000Z");
  const event = [allDay("DST day", "2026-10-25", "2026-10-26")];
  assert.equal(model(event, Date.parse("2026-10-25T22:59:59Z")).agenda.length, 1);
  assert.equal(model(event, Date.parse("2026-10-25T23:00:00Z")).agenda.length, 0);
});

test("cancelled entries are excluded; malformed responses fail rather than look empty", () => {
  assert.deepEqual(normalizeEvents([{ ...timed("Cancelled", 10, 20), status: "cancelled" }], ZONE), []);
  for (const response of [null, {}, [null], [{ summary: "Invalid", start: {}, end: {} }], [allDay("Invalid date", "2026-02-31")]]) {
    assert.throws(() => normalizeEvents(response, ZONE));
  }
});

test("a zero-duration appointment counts down and disappears at its start", () => {
  const events = [timed("Reminder", 5, 5)];
  assert.equal(model(events).focus.status, "in 5 minutes");
  assert.equal(model(events, NOW + 5 * MINUTE).focus, null);
});
