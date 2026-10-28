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

async function render() {
  const scenario = document.querySelector("#scenario").value;
  const co2 = document.querySelector("#co2").value;
  offset = +document.querySelector("#offset").value;
  document.querySelector("#offset-label").textContent = `${offset} min`;
  const scale = +document.querySelector("#scale").value;
  document.querySelector("#scale-label").textContent = `${scale}`;
  card.setConfig({ type: "custom:echo-show-card", calendar: "calendar.preview", co2_entity: PREVIEW_CO2_ENTITY, co2_indicator_scale: scale });
  card.hass = {
    connected: scenario !== "offline",
    config: { time_zone: "Europe/Berlin" },
    states: {
      "calendar.preview": { state: "off", attributes: { friendly_name: "Personal calendar" } },
      [PREVIEW_CO2_ENTITY]: { state: co2, attributes: { unit_of_measurement: "ppm" } },
    },
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
// Exposed only by this local, synthetic preview for browser verification.
window.echoPreview = { card, render, scenarios };
await render();
