import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CO2_SETTINGS, EchoShowCard, calendarMidnight, co2Foreground, co2Reading, co2Settings, displayEvents, normalizeEvents } from "../echo-show-card.js";

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
  for (const [value, band] of [["599.9", "normal"], ["600", "warning"], ["1000", "warning"], ["1000.1", "critical"]]) {
    assert.deepEqual(co2Reading({ state: value, attributes: { unit_of_measurement: "ppm" } }), { band, label: `CO₂ ${value} ppm` });
  }
});

test("CO₂ missing, invalid, wrong-unit and disconnected readings are unavailable", () => {
  for (const state of [undefined, { state: "" }, { state: "  " }, { state: "unknown" }, { state: "unavailable" }, { state: "Infinity" }, { state: "-1" }, { state: "900", attributes: { unit_of_measurement: "ppb" } }]) {
    assert.deepEqual(co2Reading(state), { band: "unavailable", label: "CO₂ unavailable" });
  }
  assert.equal(co2Reading({ state: "1200" }, false).band, "unavailable");
});

test("custom fractional CO₂ thresholds preserve inclusive warning and exclusive critical boundaries", () => {
  const settings = co2Settings({ co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5 });
  for (const [value, band] of [["700.49", "normal"], ["700.5", "warning"], ["1200.5", "warning"], ["1200.51", "critical"]]) {
    assert.deepEqual(co2Reading({ state: value }, true, settings), { band, label: `CO₂ ${value} ppm` });
  }
  assert.equal(co2Reading({ state: "0" }, true, co2Settings({ co2_warning_threshold: 0 })).band, "warning");
});

test("CO₂ settings merge defaults and reject invalid thresholds and colors", () => {
  assert.deepEqual(co2Settings(), DEFAULT_CO2_SETTINGS);
  assert.deepEqual(co2Settings({ co2_warning_color: " #ABCDEF " }), { ...DEFAULT_CO2_SETTINGS, co2_warning_color: "#abcdef" });
  assert.equal(co2Settings({ co2_warning_threshold: 0, co2_critical_threshold: 0.1 }).co2_warning_threshold, 0);
  for (const key of ["co2_warning_threshold", "co2_critical_threshold"]) {
    for (const value of ["", "700", null, true, -1, NaN, Infinity]) {
      assert.throws(() => co2Settings({ [key]: value }), /finite, nonnegative/);
    }
  }
  for (const warning of [1000, 1001]) {
    assert.throws(() => co2Settings({ co2_warning_threshold: warning }), /below/);
  }
  for (const key of ["co2_normal_color", "co2_warning_color", "co2_critical_color"]) {
    for (const value of ["", null, 123456, "red", "#abc", "#gggggg", "#ffffffff", "url(example)"]) {
      assert.throws(() => co2Settings({ [key]: value }), /#RRGGBB/);
    }
  }
});

test("invalid card settings leave the last valid configuration intact", () => {
  const card = new EchoShowCard();
  card.setConfig({ calendar: "calendar.personal", co2_warning_threshold: 700 });
  assert.throws(() => card.setConfig({ calendar: "calendar.other", co2_warning_threshold: 1200 }), /below/);
  assert.equal(card._config.calendar, "calendar.personal");
  assert.equal(card._co2Settings.co2_warning_threshold, 700);
});

test("CO₂ foreground adapts to light, dark and middle-luminance backgrounds", () => {
  for (const color of ["#ffffff", "#e5c76b", "#808080", "#777777"]) assert.equal(co2Foreground(color), "#000000");
  for (const color of ["#000000", "#151c24", "#af4d47", "#757575"]) assert.equal(co2Foreground(color), "#ffffff");
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

test("dismissals match refreshed occurrences and leave later events and the agenda intact", () => {
  const raw = [timed("Reading", -20, 40), timed("Reading", 120, 180), allDay("Holiday")];
  const dismissed = normalizeEvents(raw, ZONE).filter((event) => !event.allDay && event.start < NOW);
  const refreshed = normalizeEvents(structuredClone(raw), ZONE);
  const result = displayEvents(refreshed, NOW, dismissed);
  assert.equal(result.focus, null);
  assert.deepEqual(result.agenda.map((event) => event.title), ["Holiday", "Reading"]);
  assert.equal(displayEvents(refreshed, NOW + 120 * MINUTE, dismissed).focus.status, "ongoing");
});

test("dismissing a shared focus reveals another ongoing event, then the next countdown", () => {
  const events = normalizeEvents([timed("A", -20, 40), timed("B", -20, 50), timed("C", -10, 60), timed("Next", 15, 75)], ZONE);
  const first = displayEvents(events, NOW).focus.events;
  assert.deepEqual(first.map((event) => event.title), ["A", "B"]);
  const second = displayEvents(events, NOW, first).focus;
  assert.equal(second.events[0].title, "C");
  const next = displayEvents(events, NOW, [...first, ...second.events]).focus;
  assert.equal(next.events[0].title, "Next");
  assert.equal(next.status, "in 15 minutes");
});

test("card dismissals survive invalidation, expire individually, and reset on calendar change", () => {
  const card = new EchoShowCard();
  card.setConfig({ calendar: "calendar.personal" });
  card._hass = { connected: true, states: { "calendar.personal": { state: "on" } } };
  card._now = () => NOW;
  const events = normalizeEvents([timed("A", -20, 40), timed("B", -20, 50)], ZONE);
  card._events = events;
  card._status = "ready";
  card._dismissOngoing();
  assert.equal(card._displayEvents().focus, null);
  card._invalidate("unavailable");
  card._events = structuredClone(events);
  card._status = "ready";
  card.setConfig({ calendar: "calendar.personal", co2_warning_threshold: 700 });
  assert.equal(card._displayEvents().focus, null);
  card._now = () => NOW + 40 * MINUTE;
  card._displayEvents();
  assert.deepEqual(card._dismissedEvents.map((event) => event.title), ["B"]);
  card._now = () => NOW + 50 * MINUTE;
  card._displayEvents();
  assert.deepEqual(card._dismissedEvents, []);
  card._now = () => NOW;
  card._dismissOngoing();
  assert.equal(card._dismissedEvents.length, 2);
  card.setConfig({ calendar: "calendar.other" });
  assert.deepEqual(card._dismissedEvents, []);
});

test("Done ignores a countdown or unavailable data and treats an edited event as a new occurrence", () => {
  const card = new EchoShowCard();
  card.setConfig({ calendar: "calendar.personal" });
  card._hass = { connected: true, states: { "calendar.personal": { state: "on" } } };
  card._now = () => NOW;
  card._events = normalizeEvents([timed("Next", 15, 75)], ZONE);
  card._status = "ready";
  card._dismissOngoing();
  assert.deepEqual(card._dismissedEvents, []);
  card._events = normalizeEvents([timed("Ongoing", -20, 40)], ZONE);
  card._hass.connected = false;
  card._dismissOngoing();
  assert.deepEqual(card._dismissedEvents, []);
  card._hass.connected = true;
  card._dismissOngoing();
  card._events = normalizeEvents([timed("Edited ongoing", -20, 40)], ZONE);
  assert.equal(card._displayEvents().focus.events[0].title, "Edited ongoing");
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
