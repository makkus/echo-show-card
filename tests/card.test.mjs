import test from "node:test";
import assert from "node:assert/strict";
import { CO2_CORNERS, DEFAULT_CO2_SETTINGS, EchoShowCard, calendarMidnight, co2Reading, co2Settings, displayEvents, normalizeEvents, sensorReading, valueSettings } from "../echo-show-card.js";

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
    const reading = co2Reading({ state: value, attributes: { unit_of_measurement: "ppm" } });
    assert.equal(reading.band, band);
    assert.equal(reading.label, `CO₂ ${value} ppm`);
  }
});

test("CO₂ missing, invalid, wrong-unit and disconnected readings are unavailable", () => {
  for (const state of [undefined, { state: "" }, { state: "  " }, { state: "unknown" }, { state: "unavailable" }, { state: "Infinity" }, { state: "-1" }, { state: "900", attributes: { unit_of_measurement: "ppb" } }]) {
    assert.deepEqual(co2Reading(state), { band: "unavailable", label: "CO₂ unavailable", radiusFraction: 0 });
  }
  assert.equal(co2Reading({ state: "1200" }, false).band, "unavailable");
});

test("custom fractional CO₂ thresholds preserve inclusive warning and exclusive critical boundaries", () => {
  const settings = co2Settings({ co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5 });
  for (const [value, band] of [["700.49", "normal"], ["700.5", "warning"], ["1200.5", "warning"], ["1200.51", "critical"]]) {
    const reading = co2Reading({ state: value }, true, settings);
    assert.equal(reading.band, band);
    assert.equal(reading.label, `CO₂ ${value} ppm`);
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

test("CO₂ radius grows proportionally and saturates at twice the configured critical threshold", () => {
  for (const [value, fraction] of [["0", 0], ["500", 0.25], ["600", 0.3], ["800", 0.4], ["1000", 0.5], ["1200", 0.6], ["2000", 1], ["10000", 1]]) {
    assert.equal(co2Reading({ state: value }).radiusFraction, fraction);
  }
  const settings = co2Settings({ co2_critical_threshold: 1200, co2_indicator_scale: 1.5 });
  assert.equal(co2Reading({ state: "1200" }, true, settings).radiusFraction, 0.5, "scale does not change the growth fraction");
  assert.equal(co2Reading({ state: "2400" }, true, settings).radiusFraction, 1);
  assert.equal(co2Reading({ state: "2401" }, true, settings).radiusFraction, 1);
  assert.equal(co2Reading({ state: "2400" }, false, settings).radiusFraction, 0);
  const large = co2Settings({ co2_critical_threshold: Number.MAX_VALUE });
  assert.equal(co2Reading({ state: String(Number.MAX_VALUE) }, true, large).radiusFraction, 0.5);
});

test("indicator scale defaults to 1, accepts fractional bounds and rejects invalid settings", () => {
  assert.equal(co2Settings().co2_indicator_scale, 1);
  for (const value of [0.5, 0.75, 1, 1.125, 1.5]) {
    assert.equal(co2Settings({ co2_indicator_scale: value }).co2_indicator_scale, value);
  }
  for (const value of [0, -1, 0.499, 1.501, "1", "", null, true, NaN, Infinity]) {
    assert.throws(() => co2Settings({ co2_indicator_scale: value }), /scale.*0\.5.*1\.5/);
  }
  const card = new EchoShowCard();
  card.setConfig({ co2_indicator_scale: 1.25 });
  assert.throws(() => card.setConfig({ co2_indicator_scale: 2 }), /scale/);
  assert.equal(card._co2Settings.co2_indicator_scale, 1.25);
});

test("indicator corners default to top-right and reject unsupported anchors", () => {
  assert.equal(co2Settings().co2_indicator_corner, "top-right");
  for (const corner of CO2_CORNERS) assert.equal(co2Settings({ co2_indicator_corner: corner }).co2_indicator_corner, corner);
  for (const corner of ["", "left", "TOP-RIGHT", null, 1]) assert.throws(() => co2Settings({ co2_indicator_corner: corner }), /corner/);
});

test("indicator coordinates default to the whole-card top-right and override legacy corner axes", () => {
  const coordinates = (config) => {
    const settings = co2Settings(config);
    return [settings.co2_indicator_x, settings.co2_indicator_y];
  };
  assert.deepEqual(coordinates({}), [100, 0]);
  for (const [corner, point] of [["top-right", [100, 0]], ["top-left", [0, 0]], ["bottom-left", [0, 100]], ["bottom-right", [100, 100]]]) {
    assert.deepEqual(coordinates({ co2_indicator_corner: corner }), point);
  }
  assert.deepEqual(coordinates({ co2_indicator_x: 0, co2_indicator_y: 0 }), [0, 0]);
  assert.deepEqual(coordinates({ co2_indicator_corner: "bottom-right", co2_indicator_x: 12.5, co2_indicator_y: 73.25 }), [12.5, 73.25]);
  assert.deepEqual(coordinates({ co2_indicator_corner: "bottom-left", co2_indicator_x: 50 }), [50, 100]);
});

test("coordinate validation accepts fractional percentages and preserves the last valid card configuration", () => {
  for (const key of ["co2_indicator_x", "co2_indicator_y"]) {
    for (const value of [0, 12.5, 50, 73.25, 100]) assert.equal(co2Settings({ [key]: value })[key], value);
    for (const value of [-0.01, 100.01, NaN, Infinity, "50", "", null, true]) {
      assert.throws(() => co2Settings({ [key]: value }), /0 to 100 percent/);
    }
  }
  const card = new EchoShowCard();
  card.setConfig({ co2_indicator_x: 50, co2_indicator_y: 50 });
  assert.throws(() => card.setConfig({ co2_indicator_x: 101 }), /0 to 100 percent/);
  assert.equal(card._co2Settings.co2_indicator_x, 50);
  assert.equal(card._co2Settings.co2_indicator_y, 50);
});

test("values default to CO₂, while explicit lists control order, labels, and hiding", () => {
  assert.deepEqual(valueSettings(), []);
  assert.deepEqual(valueSettings({ co2_entity: "sensor.co2" }), [{ entity: "sensor.co2" }]);
  assert.deepEqual(valueSettings({ co2_entity: "sensor.co2", values: [] }), []);
  const values = [{ entity: "sensor.temperature", label: " Room " }, { entity: "sensor.humidity", label: " " }];
  assert.deepEqual(valueSettings({ co2_entity: "sensor.co2", values }), [{ entity: "sensor.temperature", label: "Room" }, { entity: "sensor.humidity" }]);
  assert.equal(values[0].label, " Room ", "normalizing must not mutate user configuration");
  for (const invalid of [null, {}, "sensor.co2", ["sensor.co2"], [{ entity: "light.room" }], [{ entity: "" }], [null], [{ entity: "sensor.co2", label: 1 }], Array(5).fill({ entity: "sensor.co2" })]) {
    assert.throws(() => valueSettings({ values: invalid }));
  }
  const card = new EchoShowCard();
  card.setConfig({ co2_entity: "sensor.co2", values });
  assert.throws(() => card.setConfig({ co2_entity: "sensor.other", values: [{ entity: "bad" }] }), /sensor entity/);
  assert.equal(card._config.co2_entity, "sensor.co2");
  assert.deepEqual(card._values, [{ entity: "sensor.temperature", label: "Room" }, { entity: "sensor.humidity" }]);
});

test("readings use HA names, precision and unit parts without rounding the indicator", () => {
  const state = { entity_id: "sensor.temperature", state: "-2.456", attributes: { unit_of_measurement: "°C", friendly_name: "Raw name" } };
  const parts = [{ type: "value", value: "−2,5" }, { type: "literal", value: " " }, { type: "unit", value: "°C" }];
  const hass = { connected: true, states: { "sensor.temperature": state },
    formatEntityName: (entity) => { assert.equal(entity, state); return "Room temperature"; },
    formatEntityStateToParts: (entity) => { assert.equal(entity, state); return parts; },
  };
  assert.deepEqual(sensorReading({ entity: "sensor.temperature" }, hass), { entity: "sensor.temperature", label: "Room temperature", available: true, exists: true, parts });
  assert.equal(sensorReading({ entity: "sensor.temperature", label: "Outside" }, hass).label, "Outside");
  assert.equal(co2Reading({ state: "1000.1" }).band, "critical");
  delete hass.formatEntityStateToParts;
  hass.formatEntityState = () => "−2,5 °C";
  assert.deepEqual(sensorReading({ entity: "sensor.temperature" }, hass).parts, [{ type: "value", value: "−2,5 °C" }]);
});

test("invalid and disconnected readings show a dash without affecting independent sensors", () => {
  const hass = { connected: true, states: {
    "sensor.temperature": { state: "-5.2", attributes: { friendly_name: "Room", unit_of_measurement: "°C" } },
    "sensor.other": { state: "unknown", attributes: { friendly_name: "Other" } },
  } };
  const entry = { entity: "sensor.temperature" };
  assert.equal(sensorReading(entry, hass).available, true, "negative temperature is valid");
  assert.equal(sensorReading({ entity: "sensor.other" }, hass).available, false);
  for (const raw of ["", " ", "unknown", "unavailable", "NaN", "Infinity"]) {
    hass.states[entry.entity].state = raw;
    const reading = sensorReading(entry, hass);
    assert.equal(reading.label, "Room");
    assert.equal(reading.exists, true, "temporary unavailability still allows opening details");
    assert.deepEqual(reading.parts, [{ type: "value", value: "—" }]);
  }
  hass.states[entry.entity].state = "21";
  assert.equal(sensorReading(entry, { ...hass, connected: false }).available, false);
  const missing = sensorReading({ entity: "sensor.missing" }, hass);
  assert.equal(missing.exists, false);
  assert.equal(missing.label, "sensor.missing");
  assert.deepEqual(missing.parts, [{ type: "value", value: "—" }]);
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
