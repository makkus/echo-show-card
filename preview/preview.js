import "../echo-show-card.js";
const PREVIEW_CO2_ENTITY = "sensor.preview_co2";

const card = document.querySelector("echo-show-card");
const base = Date.now();
let offset = 0;
const timed = (title, start, duration = 60) => ({
  summary: title,
  start: { dateTime: new Date(base + start * 60_000).toISOString() },
  end: { dateTime: new Date(base + (start + duration) * 60_000).toISOString() },
});
const tomorrow = new Date(base + 86_400_000).toISOString().slice(0, 10);
const afterTomorrow = new Date(base + 2 * 86_400_000).toISOString().slice(0, 10);
const agenda = [
  timed("Lunch with Alex", 125),
  timed("A walk in the park", 245),
  { summary: "Day off", start: { date: tomorrow }, end: { date: afterTomorrow } },
  timed("Book club", 2 * 1440),
  timed("Weekend market", 3 * 1440),
];
const scenarios = {
  agenda,
  countdown: [timed("Lunch with Alex", 37), ...agenda],
  ongoing: [timed("Reading time", -20), ...agenda],
  overlap: [timed("Quiet afternoon", -60, 180), timed("Team catch-up", 10), ...agenda],
  simultaneous: [timed("Lunch with Alex", 20), timed("Call with Sam", 20), ...agenda],
  long: [timed("Planning the weekend: a very long event title that wraps across several lines and ends with an ellipsis when it reaches the available space", 25)],
  empty: [], error: [], offline: [],
};

card._now = () => Date.now() + offset * 60_000;
const readings = [
  { entity: PREVIEW_CO2_ENTITY }, { entity: "sensor.preview_temperature" },
  { entity: "sensor.preview_humidity" }, { entity: "sensor.preview_pressure" },
];

// Synthetic stand-ins for HA's name and parts formatters; no HA code is loaded.
const formatEntityName = (state) => state.attributes.friendly_name || state.entity_id;
function formatEntityStateToParts(state) {
  const value = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 20 }).format(Number(state.state));
  const parts = [{ type: "value", value }];
  if (state.attributes.unit_of_measurement) parts.push({ type: "literal", value: " " }, { type: "unit", value: state.attributes.unit_of_measurement });
  return parts;
}

async function render() {
  const scenario = document.querySelector("#scenario").value;
  const co2 = document.querySelector("#co2").value;
  offset = +document.querySelector("#offset").value;
  document.querySelector("#offset-label").textContent = `${offset} min`;
  const scale = +document.querySelector("#scale").value;
  document.querySelector("#scale-label").textContent = `${scale}`;
  const selection = document.querySelector("#values").value;
  const values = selection === "default" ? undefined : readings.slice(0, selection === "long" ? 4 : Number(selection)).map((entry, index) => ({
    ...entry, ...(selection === "long" ? { label: `A very long room sensor label for reading ${index + 1} that should wrap neatly` } : {}),
  }));
  card.setConfig({ type: "custom:echo-show-card", calendar: "calendar.preview", co2_entity: PREVIEW_CO2_ENTITY,
    co2_indicator_scale: scale, co2_indicator_corner: document.querySelector("#corner").value, ...(values === undefined ? {} : { values }) });
  card.hass = {
    connected: scenario !== "offline",
    config: { time_zone: "Europe/Berlin" },
    states: {
      "calendar.preview": { state: "off", attributes: { friendly_name: "Personal calendar" } },
      [PREVIEW_CO2_ENTITY]: { entity_id: PREVIEW_CO2_ENTITY, state: co2, attributes: { friendly_name: "CO₂", unit_of_measurement: "ppm" } },
      "sensor.preview_temperature": { entity_id: "sensor.preview_temperature", state: "21.4", attributes: { friendly_name: "Room temperature", unit_of_measurement: "°C" } },
      "sensor.preview_humidity": { entity_id: "sensor.preview_humidity", state: "48", attributes: { friendly_name: "Humidity", unit_of_measurement: "%" } },
      "sensor.preview_pressure": { entity_id: "sensor.preview_pressure", state: "1013", attributes: { friendly_name: "Air pressure", unit_of_measurement: "hPa" } },
    },
    formatEntityName, formatEntityStateToParts,
    callApi: async () => {
      if (scenario === "error") throw new Error("Synthetic calendar failure");
      return scenarios[scenario];
    },
  };
  // setConfig can start a read using the previous synthetic hass object. Force
  // a fresh generation after assigning the scenario, just as a calendar change does.
  card._invalidate("loading");
  await card._refresh();
  card._tick();
}

for (const element of document.querySelectorAll("select,input")) element.addEventListener("input", render);
document.querySelector("#reset").addEventListener("click", () => { document.querySelector("#offset").value = "0"; render(); });
document.addEventListener("hass-more-info", (event) => {
  const state = card._hass.states[event.detail.entityId];
  const dialog = document.querySelector("#reading-details");
  dialog.querySelector("h2").textContent = formatEntityName(state);
  dialog.querySelector("[data-preview-state]").textContent = card._hass.connected && Number.isFinite(Number(state.state))
    ? formatEntityStateToParts(state).map((part) => part.value).join("") : "Unavailable";
  dialog.showModal();
});
// Exposed only by this local, synthetic preview for browser verification.
window.echoPreview = { card, render, scenarios };
await render();
