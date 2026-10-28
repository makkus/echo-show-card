// Home Assistant clock, agenda and CO2 card. No runtime dependencies.
export const DEFAULT_CO2_ENTITY = "";
export const CO2_CORNERS = Object.freeze(["top-right", "top-left", "bottom-left", "bottom-right"]);
export const DEFAULT_CO2_SETTINGS = Object.freeze({
  co2_warning_threshold: 600,
  co2_critical_threshold: 1000,
  co2_normal_color: "#151c24",
  co2_warning_color: "#e5c76b",
  co2_critical_color: "#af4d47",
  co2_indicator_scale: 1,
  co2_indicator_corner: "top-right",
});
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const REFRESH = MINUTE;
const REQUEST_TIMEOUT = 15_000;
const MAX_DATA_AGE = 90_000;

const formats = new Map();
function formatter(timeZone, kind) {
  const key = `${timeZone}/${kind}`;
  if (!formats.has(key)) {
    const options = {
      parts: { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" },
      clock: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      date: { weekday: "long", day: "numeric", month: "long" },
      shortDate: { weekday: "short", day: "numeric", month: "short" },
    };
    formats.set(key, new Intl.DateTimeFormat("en-GB", { timeZone, ...options[kind] }));
  }
  return formats.get(key);
}

function dateParts(time, timeZone) {
  return Object.fromEntries(formatter(timeZone, "parts").formatToParts(time).map(({ type, value }) => [type, value]));
}

function dateKey(time, timeZone) {
  const p = dateParts(time, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

// A calendar date belongs to HA's timezone, which can differ from the tablet's.
// Iterate the zone offset so DST transitions do not turn all-day dates into UTC dates.
export function calendarMidnight(date, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid calendar date");
  const target = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) {
    throw new Error("Invalid calendar date");
  }
  let result = target;
  for (let i = 0; i < 4; i += 1) {
    const p = dateParts(result, timeZone);
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const correction = target - local;
    if (!correction) return result;
    result += correction;
  }
  throw new Error("Calendar midnight could not be resolved");
}

export function normalizeEvents(rawEvents, timeZone) {
  if (!Array.isArray(rawEvents)) throw new Error("Invalid calendar response");
  return rawEvents.filter((event) => event?.status !== "cancelled").map((event) => {
    const allDay = typeof event?.start?.date === "string";
    const start = allDay ? calendarMidnight(event.start.date, timeZone) : Date.parse(event?.start?.dateTime);
    const end = allDay ? calendarMidnight(event?.end?.date, timeZone) : Date.parse(event?.end?.dateTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new Error("Invalid calendar event interval");
    }
    return { start, end, allDay, title: typeof event.summary === "string" && event.summary.trim() ? event.summary : "Untitled event" };
  }).sort((a, b) => a.start - b.start || a.title.localeCompare(b.title, "en"));
}

// Range reads return fresh objects; match the event occurrence by its displayed data.
function eventKey(event) { return JSON.stringify([event.start, event.end, event.title]); }

export function displayEvents(events, now, dismissedEvents = []) {
  const dismissed = new Set(dismissedEvents.map(eventKey));
  const timed = events.filter((event) => !event.allDay && !dismissed.has(eventKey(event)));
  const ongoing = timed.filter((event) => event.start <= now && event.end > now);
  const approaching = timed.filter((event) => event.start > now && event.start - now < 60 * MINUTE);
  const candidates = ongoing.length ? ongoing : approaching;
  const firstStart = candidates.length ? Math.min(...candidates.map((event) => event.start)) : null;
  let focus = null;
  if (firstStart !== null) {
    const remaining = firstStart - now;
    focus = {
      events: candidates.filter((event) => event.start === firstStart),
      status: ongoing.length ? "ongoing" : remaining < MINUTE ? "in less than a minute" : `in ${Math.ceil(remaining / MINUTE)} ${Math.ceil(remaining / MINUTE) === 1 ? "minute" : "minutes"}`,
      start: firstStart,
    };
  }
  const agenda = events.filter((event) => event.start < now + 7 * DAY && (
    event.allDay ? event.end > now : event.start >= now
  )).slice(0, 5);
  return { focus, agenda };
}

export function co2Settings(config = {}) {
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CO2_SETTINGS)) {
    const value = config[key] === undefined ? fallback : config[key];
    const label = key.replace("co2_", "CO₂ ").replaceAll("_", " ");
    if (key.endsWith("_threshold")) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`${label} must be a finite, nonnegative number in ppm`);
      }
      settings[key] = value;
    } else if (key === "co2_indicator_scale") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 1.5) {
        throw new Error("CO₂ indicator scale must be a number from 0.5 to 1.5");
      }
      settings[key] = value;
    } else if (key === "co2_indicator_corner") {
      if (!CO2_CORNERS.includes(value)) throw new Error("Choose a CO₂ indicator corner: top-right, top-left, bottom-left, or bottom-right");
      settings[key] = value;
    } else {
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
        throw new Error(`${label} must be a hex color in #RRGGBB format`);
      }
      settings[key] = value.trim().toLowerCase();
    }
  }
  if (settings.co2_warning_threshold >= settings.co2_critical_threshold) {
    throw new Error("The warning threshold must be below the critical threshold");
  }
  return settings;
}

export function co2Reading(state, connected = true, settings = DEFAULT_CO2_SETTINGS) {
  const raw = state?.state;
  const unit = state?.attributes?.unit_of_measurement;
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!connected || !Number.isFinite(value) || value < 0 || (unit && unit !== "ppm")) {
    return { band: "unavailable", label: "CO₂ unavailable", radiusFraction: 0 };
  }
  return {
    band: value > settings.co2_critical_threshold ? "critical" : value >= settings.co2_warning_threshold ? "warning" : "normal",
    // Preserve fractional readings so a critical 1000.1 is not labeled 1000.
    label: `CO₂ ${raw.trim()} ppm`,
    radiusFraction: Math.min(1, value / settings.co2_critical_threshold / 2),
  };
}

export function valueSettings(config = {}) {
  const entries = config.values === undefined ? (config.co2_entity ? [{ entity: config.co2_entity }] : []) : config.values;
  if (!Array.isArray(entries) || entries.length > 4) throw new Error("Values must be a list of up to four sensor readings");
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== "object" || typeof entry.entity !== "string" || !/^sensor\.[a-z0-9_]+$/.test(entry.entity)) {
      throw new Error(`Choose a sensor entity for reading ${index + 1}`);
    }
    if (entry.label !== undefined && typeof entry.label !== "string") throw new Error(`The label for reading ${index + 1} must be text`);
    return { entity: entry.entity, ...(entry.label?.trim() ? { label: entry.label.trim() } : {}) };
  });
}

export function sensorReading(entry, hass) {
  const state = hass?.states?.[entry.entity];
  const label = entry.label || (state && hass?.formatEntityName?.(state)) || state?.attributes?.friendly_name || entry.entity;
  const raw = state?.state;
  const available = hass?.connected === true && typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw));
  let parts = [{ type: "value", value: "—" }];
  if (available) {
    if (hass.formatEntityStateToParts) parts = hass.formatEntityStateToParts(state);
    else if (hass.formatEntityState) parts = [{ type: "value", value: hass.formatEntityState(state) }];
    else {
      // Minimal embedding/test hass objects may not expose HA's formatters.
      parts = [{ type: "value", value: raw.trim() }];
      if (state.attributes?.unit_of_measurement) parts.push({ type: "literal", value: " " }, { type: "unit", value: state.attributes.unit_of_measurement });
    }
  }
  return { entity: entry.entity, label, available, exists: Boolean(state), parts };
}

function agendaWhen(event, now, timeZone) {
  const date = Math.max(event.start, event.allDay ? now : event.start);
  const day = dateKey(date, timeZone);
  const today = dateKey(now, timeZone);
  // Noon + one day always identifies tomorrow across European DST transitions.
  const tomorrow = dateKey(calendarMidnight(today, timeZone) + 36 * 60 * MINUTE, timeZone);
  const label = day === today ? "Today" : day === tomorrow ? "Tomorrow" : formatter(timeZone, "shortDate").format(date);
  return `${label} · ${event.allDay ? "All day" : formatter(timeZone, "clock").format(event.start)}`;
}

const STYLES = `
  :host { display:block; width:100%; height:100%; min-height:240px; color:#f0f3f6;
    --bg:#151c24; --ink:#f0f3f6; --muted:#acb6c2;
    --pad:clamp(22px,4vw,60px); --bottom-pad:clamp(24px,5vh,48px); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  * { box-sizing:border-box; }
  .display { height:100%; width:100%; overflow:hidden; background:var(--bg); color:var(--ink); }
  .layout { height:100%; min-height:0; display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); }
  :host([data-focus]) .layout { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .clock { text-align:center; min-width:0; min-height:0; padding:var(--pad); padding-bottom:var(--bottom-pad); display:flex; flex-direction:column; }
  .clock-content { flex:1; min-height:0; display:flex; flex-direction:column; justify-content:center; }
  .values { flex:none; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px 24px;
    text-align:left; margin-top:clamp(24px,4vh,40px); }
  .values[data-count="1"] { grid-template-columns:minmax(0,1fr); }
  .reading { min-width:0; min-height:64px; padding:0; border:0; border-radius:4px; background:transparent; color:var(--ink);
    font:inherit; text-align:left; cursor:pointer; }
  .reading:focus-visible { outline:2px solid #b2c5d8; outline-offset:6px; }
  .reading:disabled { cursor:default; opacity:.65; }
  .reading-value { display:block; font-size:clamp(24px,2.8vw,40px); font-weight:400; line-height:1.2;
    font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .reading-unit { font-size:.48em; color:var(--muted); }
  .reading-label { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden;
    overflow-wrap:anywhere; margin-top:6px; color:var(--muted); font-size:clamp(12px,1.15vw,17px); line-height:1.35; }
  .reading[data-unavailable] .reading-value { color:var(--muted); }
  @media (min-width:1100px) { :host(:not([data-focus])) .values { grid-template-columns:repeat(var(--value-count),minmax(0,1fr)); } }
  .calendar-panel { min-width:0; min-height:0; padding:var(--pad); padding-bottom:var(--bottom-pad); display:flex; flex-direction:column;
    position:relative; isolation:isolate; background:var(--bg); border-left:1px solid #ffffff22; }
  .co2-indicator { position:absolute; top:0; right:0; width:100%; height:100%; overflow:hidden;
    pointer-events:none; z-index:0; }
  .co2-shape { fill:var(--co2-color,#151c24); transform:scale(var(--co2-size,0)); opacity:var(--co2-visible,0);
    transition:transform 1s ease,fill 1s ease,opacity 1s ease; }
  .calendar-content { position:relative; z-index:1; flex:1; min-height:0; display:flex; flex-direction:column; justify-content:flex-end; }
  .calendar-text { background:#151c24f0; box-shadow:0 0 8px 4px #151c24f0;
    -webkit-box-decoration-break:clone; box-decoration-break:clone; }
  .time { display:block; font-size:clamp(64px,15vw,216px); font-weight:350; line-height:1.1;
    letter-spacing:-.055em; font-variant-numeric:tabular-nums; white-space:nowrap; }
  :host([data-focus]) .time { font-size:clamp(54px,12.5vw,180px); }
  .date { margin-top:18px; color:var(--muted); font-size:clamp(14px,1.8vw,26px); }
  .agenda, .focus { min-width:0; }
  [hidden] { display:none !important; }
  h2 { font-size:clamp(12px,1.2vw,17px); font-weight:500; color:var(--muted); letter-spacing:.14em;
    text-transform:uppercase; margin:0 0 26px; }
  ul { list-style:none; margin:0; padding:0; }
  li + li { margin-top:clamp(14px,2.5vh,26px); }
  .when { color:var(--muted); font-size:clamp(11px,1.15vw,17px); margin-bottom:5px; }
  .title { font-size:clamp(14px,1.7vw,25px); line-height:1.3; font-weight:450; }
  .clamp { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden;
    overflow-wrap:anywhere; }
  .focus-title { font-size:clamp(24px,3.6vw,54px); line-height:1.15; font-weight:450; margin:0; }
  .focus-status { font-size:clamp(18px,2.5vw,36px); color:var(--muted); margin:24px 0 0; line-height:1.3; }
  .done { margin-top:24px; min-width:88px; min-height:48px; padding:10px 22px; border:1px solid currentColor;
    border-radius:8px; background:#151c24f0; color:inherit; font:inherit; font-size:clamp(16px,1.7vw,24px); cursor:pointer; }
  .done:focus-visible { outline:3px solid currentColor; outline-offset:4px; }
  .done:active { opacity:.7; }
  .empty { color:var(--muted); font-size:clamp(14px,1.7vw,24px); line-height:1.5; }
  @media (prefers-reduced-motion:reduce) { .co2-shape { transition:none; } }
  @media (max-height:550px) { .clock,.calendar-panel { padding-top:22px; }
    h2 { margin-bottom:16px; } li + li { margin-top:10px; }
    .title { -webkit-line-clamp:2; } .date { margin-top:10px; } }
`;

const ElementBase = globalThis.HTMLElement ?? class {};

export class EchoShowCard extends ElementBase {
  constructor() {
    super();
    this._events = [];
    this._dismissedEvents = [];
    this._status = "loading";
    this._nextRefresh = 0;
    this._lastSuccess = 0;
    this._onVisible = () => {
      if (!document.hidden) this._tick(true);
    };
  }

  static getStubConfig() { return { calendar: "", co2_entity: DEFAULT_CO2_ENTITY }; }
  static getConfigElement() { return document.createElement("echo-show-card-editor"); }
  getCardSize() { return 10; }
  _now() { return Date.now(); }

  setConfig(config) {
    if (config.calendar && !/^calendar\.[a-z0-9_]+$/.test(config.calendar)) throw new Error("Choose a calendar entity");
    if (config.co2_entity && !/^sensor\.[a-z0-9_]+$/.test(config.co2_entity)) throw new Error("Choose a CO₂ sensor entity");
    const settings = co2Settings(config);
    const values = valueSettings(config);
    const calendarChanged = !this._config || this._config.calendar !== config.calendar;
    this._config = { ...config, co2_entity: config.co2_entity || DEFAULT_CO2_ENTITY };
    this._co2Settings = settings;
    this._values = values;
    if (calendarChanged) {
      this._dismissedEvents = [];
      this._invalidate("loading");
    }
    this._render();
    this._refresh();
  }

  set hass(hass) {
    const wasAvailable = this._calendarAvailable();
    const previousZone = this._hass?.config?.time_zone;
    this._hass = hass;
    if (!this._calendarAvailable()) {
      this._invalidate("unavailable");
    } else if (!wasAvailable || previousZone !== hass.config?.time_zone) {
      this._invalidate("loading");
    }
    this._render();
    this._refresh();
  }

  set preview(value) { this._preview = value; this._fitHeight(); }

  connectedCallback() {
    this._timer = setInterval(() => this._tick(), 1000);
    document.addEventListener("visibilitychange", this._onVisible);
    this._tick();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    document.removeEventListener("visibilitychange", this._onVisible);
    this._invalidate("loading");
  }

  _timeZone() {
    return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  _calendarAvailable() {
    const state = this._hass?.states?.[this._config?.calendar]?.state;
    return this._hass?.connected === true && state !== undefined && state !== "unknown" && state !== "unavailable";
  }

  _invalidate(status) {
    if (this._request) clearTimeout(this._request.timeout);
    this._request = null;
    this._events = [];
    this._status = status;
    this._nextRefresh = 0;
    this._lastSuccess = 0;
  }

  _tick(force = false) {
    if (this._lastSuccess && this._now() - this._lastSuccess > MAX_DATA_AGE) this._invalidate("unavailable");
    this._fitHeight();
    this._render();
    this._refresh(force);
  }

  _fitHeight() {
    if (!this.isConnected) return;
    const height = this._preview ? Math.min(600, window.innerHeight * 0.7) : Math.max(240, window.innerHeight - Math.max(0, this.getBoundingClientRect().top));
    const css = `${Math.floor(height)}px`;
    if (this.style.height !== css) this.style.height = css;
  }

  async _refresh(force = false) {
    if (!this.isConnected || !this._calendarAvailable() || this._request) return;
    const now = this._now();
    if (!force && now < this._nextRefresh) return;
    this._nextRefresh = now + REFRESH;
    const request = {};
    this._request = request;
    const query = new URLSearchParams({ start: new Date(now).toISOString(), end: new Date(now + 7 * DAY).toISOString() });
    try {
      const raw = await Promise.race([
        this._hass.callApi("GET", `calendars/${this._config.calendar}?${query}`),
        new Promise((_, reject) => { request.timeout = setTimeout(() => reject(new Error("Calendar request timed out")), REQUEST_TIMEOUT); }),
      ]);
      if (this._request !== request) return;
      this._events = normalizeEvents(raw, this._timeZone());
      this._status = "ready";
      this._lastSuccess = this._now();
    } catch {
      if (this._request !== request) return;
      this._events = [];
      this._status = "unavailable";
    } finally {
      clearTimeout(request.timeout);
      if (this._request === request) {
        this._request = null;
        this._render();
      }
    }
  }

  _displayEvents() {
    const now = this._now();
    this._dismissedEvents = this._dismissedEvents.filter((event) => event.end > now);
    const usable = this._status === "ready" && this._calendarAvailable();
    return displayEvents(usable ? this._events : [], now, this._dismissedEvents);
  }

  _dismissOngoing() {
    const { focus } = this._displayEvents();
    if (focus?.status !== "ongoing") return;
    this._dismissedEvents.push(...focus.events);
    this._render();
  }

  _renderValues() {
    const section = this.shadowRoot.querySelector(".values");
    section.hidden = this._values.length === 0;
    section.dataset.count = this._values.length;
    section.style.setProperty("--value-count", this._values.length || 1);
    while (section.children.length > this._values.length) section.lastElementChild.remove();
    for (const [index, entry] of this._values.entries()) {
      const reading = sensorReading(entry, this._hass);
      let button = section.children[index];
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "reading";
        button.innerHTML = '<span class="reading-value"></span><span class="reading-label"></span>';
        section.append(button);
      }
      button.dataset.entity = reading.entity;
      button.disabled = !reading.exists;
      button.toggleAttribute("data-unavailable", !reading.available);
      const description = `${reading.label}: ${reading.available ? reading.parts.map((part) => part.value).join("") : "unavailable"}`;
      button.setAttribute("aria-label", `${description}. Open entity details`);
      button.title = description;
      const label = button.querySelector(".reading-label");
      if (label.textContent !== reading.label) label.textContent = reading.label;
      const value = button.querySelector(".reading-value");
      const key = JSON.stringify(reading.parts);
      if (value.dataset.parts !== key) {
        value.dataset.parts = key;
        value.replaceChildren(...reading.parts.map((part) => {
          const span = document.createElement("span");
          if (part.type === "unit") span.className = "reading-unit";
          span.textContent = part.value;
          return span;
        }));
      }
    }
  }

  _render() {
    if (!this._config || !this.isConnected) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>${STYLES}</style>
        <section class="display" aria-label="Clock and calendar">
          <main class="layout">
            <section class="clock" aria-label="Clock and sensor values">
              <div class="clock-content"><time class="time"></time><div class="date"></div></div>
              <section class="values" aria-label="Sensor values"></section>
            </section>
            <section class="calendar-panel" aria-label="Calendar and CO₂">
              <!-- A square viewBox fits the shorter panel dimension at the selected corner. -->
              <svg class="co2-indicator" viewBox="0 0 100 100" preserveAspectRatio="xMaxYMin meet" aria-hidden="true" focusable="false">
                <g transform="translate(100 0)"><circle class="co2-shape" r="60" /></g>
              </svg>
              <div class="calendar-content">
                <section class="agenda" aria-label="Upcoming events"><h2><span class="calendar-text">Coming up</span></h2><ul></ul><div class="empty"><span class="calendar-text"></span></div></section>
                <section class="focus" aria-label="Focus event" hidden><h1 class="focus-title clamp"><span class="calendar-text"></span></h1><p class="focus-status"><span class="calendar-text"></span></p><button class="done" type="button" hidden>Done</button></section>
              </div>
            </section>
          </main>
        </section>`;
      this.shadowRoot.querySelector(".done").addEventListener("click", () => this._dismissOngoing());
      this.shadowRoot.querySelector(".values").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-entity]");
        if (button && !button.disabled) this.dispatchEvent(new CustomEvent("hass-more-info", {
          detail: { entityId: button.dataset.entity }, bubbles: true, composed: true,
        }));
      });
    }
    const now = this._now();
    const timeZone = this._timeZone();
    const text = (selector, value) => {
      const element = this.shadowRoot.querySelector(selector);
      if (element.textContent !== value) element.textContent = value;
    };
    text(".time", formatter(timeZone, "clock").format(now));
    text(".date", formatter(timeZone, "date").format(now));
    const co2 = co2Reading(this._hass?.states?.[this._config.co2_entity], this._hass?.connected === true, this._co2Settings);
    this.dataset.co2 = co2.band;
    const visible = co2.band === "warning" || co2.band === "critical";
    const indicator = this.shadowRoot.querySelector(".co2-indicator");
    const corner = this._co2Settings.co2_indicator_corner;
    const right = corner.endsWith("right");
    const bottom = corner.startsWith("bottom");
    indicator.setAttribute("preserveAspectRatio", `${right ? "xMax" : "xMin"}${bottom ? "YMax" : "YMin"} meet`);
    indicator.querySelector("g").setAttribute("transform", `translate(${right ? 100 : 0} ${bottom ? 100 : 0})`);
    indicator.style.setProperty("--co2-size", visible ? co2.radiusFraction * this._co2Settings.co2_indicator_scale : 0);
    indicator.style.setProperty("--co2-visible", visible ? 1 : 0);
    // Keep the last warning color while shrinking away for normal/unavailable readings.
    if (visible) indicator.style.setProperty("--co2-color", this._co2Settings[`co2_${co2.band}_color`]);
    this.shadowRoot.querySelector(".calendar-panel").setAttribute("aria-label", `Calendar; ${co2.label}`);
    this._renderValues();
    const usable = this._status === "ready" && this._calendarAvailable();
    const model = this._displayEvents();
    this.toggleAttribute("data-focus", Boolean(model.focus));
    this.shadowRoot.querySelector(".agenda").hidden = Boolean(model.focus);
    this.shadowRoot.querySelector(".focus").hidden = !model.focus;
    this.shadowRoot.querySelector(".done").hidden = model.focus?.status !== "ongoing";
    if (model.focus) {
      text(".focus-title .calendar-text", model.focus.events.map((event) => event.title).join(" / "));
      text(".focus-status .calendar-text", model.focus.status);
    } else {
      text(".focus-title .calendar-text", "");
      text(".focus-status .calendar-text", "");
      const items = model.agenda.map((event) => ({ title: event.title, when: agendaWhen(event, now, timeZone) }));
      const key = JSON.stringify(items);
      if (key !== this._agendaKey) {
        this._agendaKey = key;
        const list = this.shadowRoot.querySelector("ul");
        list.replaceChildren(...items.map((item) => {
          const row = document.createElement("li");
          const when = document.createElement("div");
          when.className = "when";
          const whenText = document.createElement("span"); whenText.className = "calendar-text"; whenText.textContent = item.when;
          when.append(whenText);
          const title = document.createElement("div");
          title.className = "title clamp";
          const titleText = document.createElement("span"); titleText.className = "calendar-text"; titleText.textContent = item.title;
          title.append(titleText);
          row.append(when, title);
          return row;
        }));
      }
      const message = !this._config.calendar ? "Choose a calendar" : usable ? "No upcoming events" : this._status === "loading" && this._calendarAvailable() ? "Loading calendar…" : "Calendar unavailable";
      text(".empty .calendar-text", items.length ? "" : message);
    }
  }
}

class EchoShowCardEditor extends ElementBase {
  setConfig(config) {
    this._config = { co2_entity: DEFAULT_CO2_ENTITY, ...config };
    this._draft = { ...this._config };
    try { co2Settings(this._draft); valueSettings(this._draft); this._error = ""; }
    catch (error) { this._error = error.message; }
    this._render();
  }
  set hass(hass) { this._hass = hass; this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    if (!this._config || !this._hass || !this.isConnected) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>
        :host { display:block; padding:16px; font:inherit; }
        * { box-sizing:border-box; }
        label { display:block; margin-bottom:20px; }
        select,input { display:block; width:100%; margin-top:8px; padding:12px; font:inherit;
          color:var(--primary-text-color); background:var(--card-background-color); border:1px solid #888; border-radius:6px; }
        fieldset { min-width:0; margin:0 0 20px; padding:16px; border:1px solid #888; border-radius:6px; }
        legend { padding:0 6px; }
        .hint { font-size:.9em; line-height:1.5; color:var(--secondary-text-color); }
        .color-setting { margin-bottom:20px; }
        .color-setting label { margin-bottom:0; }
        .color-controls { display:flex; align-items:center; gap:12px; }
        input[type="color"] { flex:none; width:56px; height:46px; padding:4px; }
        .color-controls input[type="text"] { min-width:0; }
        .value-row { border-bottom:1px solid #8885; margin-bottom:20px; padding-bottom:16px; }
        .value-row label { margin-bottom:12px; }
        .value-actions { display:flex; flex-wrap:wrap; gap:8px; }
        button { padding:10px 16px; font:inherit; color:var(--primary-text-color); background:var(--card-background-color);
          border:1px solid #888; border-radius:6px; cursor:pointer; }
        button:disabled { opacity:.5; cursor:default; }
        .error { color:var(--error-color,#b00020); }
        [hidden] { display:none !important; }
      </style><label>Main personal calendar<select data-calendar></select></label>
      <label>CO₂ sensor<input data-entity list="co2-sensors"><datalist id="co2-sensors"></datalist></label>
      <fieldset><legend>Sensor values</legend>
        <p class="hint">Up to four readings below the clock. Tap a reading to open its entity details.</p>
        <p class="hint" data-values-default></p>
        <div data-value-rows></div><datalist id="value-sensors"></datalist>
        <div class="value-actions"><button type="button" data-add-value>Add reading</button>
          <button type="button" data-default-values>Use CO₂ default</button></div>
      </fieldset>
      <fieldset><legend>CO₂ warnings</legend>
        <label>Indicator corner<select data-setting="co2_indicator_corner" aria-describedby="co2-error">
          ${CO2_CORNERS.map((corner) => `<option value="${corner}">${corner.replace("-", " ")}</option>`).join("")}
        </select></label>
        <label>Warning threshold (ppm)<input type="number" min="0" step="any" required data-setting="co2_warning_threshold" aria-describedby="threshold-help co2-error"></label>
        <label>Critical threshold (ppm)<input type="number" min="0" step="any" required data-setting="co2_critical_threshold" aria-describedby="threshold-help co2-error"></label>
        <p class="hint" id="threshold-help">Warning starts at its threshold; critical starts above its threshold.
          The warning threshold must be below the critical threshold.</p>
        <label>Indicator scale<input type="number" min="0.5" max="1.5" step="any" required data-setting="co2_indicator_scale" aria-describedby="scale-help co2-error"></label>
        <p class="hint" id="scale-help">From 0.5 to 1.5; default 1. The radius grows with CO₂, reaching its maximum at twice
          the critical threshold. Scale 1 caps it at 60% of the panel's shorter dimension.</p>
        ${["warning", "critical"].map((level) => {
          const label = `${level[0].toUpperCase()}${level.slice(1)} indicator`;
          const key = `co2_${level}_color`;
          return `<div class="color-setting"><label for="${key}">${label}</label><div class="color-controls">
            <input type="color" data-color-picker="${key}" aria-label="${label} color picker">
            <input type="text" id="${key}" data-setting="${key}" aria-label="${label} hex value" aria-describedby="co2-error" placeholder="#RRGGBB" spellcheck="false">
          </div></div>`;
        }).join("")}
        <p class="hint">The panel stays dark. Normal and unavailable readings hide the corner indicator.</p>
        <button type="button" data-reset>Reset CO₂ settings</button>
        <p class="error" id="co2-error" role="alert" hidden></p>
      </fieldset>`;
      this.shadowRoot.querySelector("[data-calendar]").addEventListener("change", (event) => this._change("calendar", event.target.value));
      this.shadowRoot.querySelector("[data-entity]").addEventListener("change", (event) => this._change("co2_entity", event.target.value));
      this.shadowRoot.querySelector("[data-add-value]").addEventListener("click", () => this._editValues((entries) => {
        if (entries.length < 4) entries.push({ entity: "" });
        return entries;
      }));
      this.shadowRoot.querySelector("[data-default-values]").addEventListener("click", () => {
        delete this._draft.values;
        this._applyDraft();
      });
      for (const input of this.shadowRoot.querySelectorAll("[data-setting],[data-color-picker]")) {
        input.addEventListener("input", () => {
          const value = input.type === "number" && input.value !== "" ? input.valueAsNumber : input.value;
          this._change(input.dataset.setting || input.dataset.colorPicker, value);
        });
      }
      this.shadowRoot.querySelector("[data-reset]").addEventListener("click", () => {
        const config = { ...this._draft };
        for (const key of Object.keys(DEFAULT_CO2_SETTINGS)) delete config[key];
        this._draft = config;
        this._applyDraft();
      });
    }
    const states = this._hass.states || {};
    const calendars = Object.keys(states).filter((id) => id.startsWith("calendar.")).sort();
    if (this._draft.calendar && !calendars.includes(this._draft.calendar)) calendars.push(this._draft.calendar);
    const sensors = Object.keys(states).filter((id) => id.startsWith("sensor.") && states[id]?.attributes?.unit_of_measurement === "ppm").sort();
    const valueSensors = Object.keys(states).filter((id) => id.startsWith("sensor.") && (
      states[id]?.attributes?.unit_of_measurement || Number.isFinite(Number(states[id]?.state))
    )).sort();
    const optionsKey = JSON.stringify([calendars.map((id) => [id, states[id]?.attributes?.friendly_name]), sensors, valueSensors]);
    if (optionsKey !== this._optionsKey) {
      this._optionsKey = optionsKey;
      const option = (id, label) => { const el = document.createElement("option"); el.value = id; el.textContent = label; return el; };
      this.shadowRoot.querySelector("[data-calendar]").replaceChildren(option("", "Choose a calendar"), ...calendars.map((id) => option(id, states[id]?.attributes?.friendly_name || id)));
      this.shadowRoot.querySelector("#co2-sensors").replaceChildren(...sensors.map((id) => option(id, id)));
      this.shadowRoot.querySelector("#value-sensors").replaceChildren(...valueSensors.map((id) => option(id, id)));
    }
    this.shadowRoot.querySelector("[data-calendar]").value = this._draft.calendar || "";
    const input = this.shadowRoot.querySelector("[data-entity]");
    if (this.shadowRoot.activeElement !== input) input.value = this._draft.co2_entity;
    for (const control of this.shadowRoot.querySelectorAll("[data-setting],[data-color-picker]")) {
      const key = control.dataset.setting || control.dataset.colorPicker;
      const value = this._draft[key] === undefined ? DEFAULT_CO2_SETTINGS[key] : this._draft[key];
      if (this.shadowRoot.activeElement === control) continue;
      if (control.type === "color" && (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim()))) continue;
      control.value = typeof value === "string" ? value.trim() : value;
    }
    this._renderValueEditor();
    const error = this.shadowRoot.querySelector(".error");
    error.textContent = this._error;
    error.hidden = !this._error;
  }

  _change(key, value) {
    this._draft = { ...this._draft, [key]: value };
    this._applyDraft();
  }

  _valueDrafts() {
    if (this._draft.values === undefined) return this._draft.co2_entity ? [{ entity: this._draft.co2_entity }] : [];
    return Array.isArray(this._draft.values) ? this._draft.values : [];
  }

  _editValues(edit) {
    this._draft = { ...this._draft, values: edit(this._valueDrafts().map((entry) => ({ ...entry }))) };
    this._applyDraft();
  }

  _renderValueEditor() {
    const entries = this._valueDrafts();
    const rows = this.shadowRoot.querySelector("[data-value-rows]");
    while (rows.children.length > entries.length) rows.lastElementChild.remove();
    for (const [index, entry] of entries.entries()) {
      let row = rows.children[index];
      if (!row) {
        row = document.createElement("div");
        row.className = "value-row";
        row.innerHTML = `<label>Sensor<input data-value-entity list="value-sensors" aria-describedby="co2-error"></label>
          <label>Label (optional)<input data-value-label placeholder="Home Assistant sensor name"></label>
          <div class="value-actions"><button type="button" data-value-up>Move up</button>
            <button type="button" data-value-down>Move down</button><button type="button" data-value-remove>Remove</button></div>`;
        row.querySelector("[data-value-entity]").addEventListener("change", (event) => this._editValues((items) => {
          items[index].entity = event.target.value.trim(); return items;
        }));
        row.querySelector("[data-value-label]").addEventListener("input", (event) => this._editValues((items) => {
          items[index].label = event.target.value; return items;
        }));
        for (const [action, offset] of [["up", -1], ["down", 1]]) {
          row.querySelector(`[data-value-${action}]`).addEventListener("click", () => this._editValues((items) => {
            const target = index + offset;
            if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]];
            return items;
          }));
        }
        row.querySelector("[data-value-remove]").addEventListener("click", () => this._editValues((items) => {
          items.splice(index, 1); return items;
        }));
        rows.append(row);
      }
      for (const [attribute, value] of [["entity", entry?.entity || ""], ["label", entry?.label || ""]]) {
        const input = row.querySelector(`[data-value-${attribute}]`);
        input.setAttribute("aria-label", `Reading ${index + 1} ${attribute}`);
        if (this.shadowRoot.activeElement !== input) input.value = value;
      }
      row.querySelector("[data-value-up]").disabled = index === 0;
      row.querySelector("[data-value-down]").disabled = index === entries.length - 1;
    }
    this.shadowRoot.querySelector("[data-add-value]").disabled = entries.length >= 4;
    this.shadowRoot.querySelector("[data-default-values]").disabled = this._draft.values === undefined;
    this.shadowRoot.querySelector("[data-values-default]").textContent = this._draft.values === undefined
      ? "Using the selected CO₂ sensor by default. Editing this list makes it explicit."
      : entries.length ? "Readings appear in this order. The indicator sensor is configured separately." : "No readings are displayed.";
  }

  _applyDraft() {
    try {
      co2Settings(this._draft);
      valueSettings(this._draft);
      this._error = "";
    } catch (error) {
      this._error = error.message;
      this._render();
      return;
    }
    this._config = { ...this._draft };
    this._render();
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
}

if (globalThis.customElements && !customElements.get("echo-show-card")) {
  customElements.define("echo-show-card", EchoShowCard);
  customElements.define("echo-show-card-editor", EchoShowCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "echo-show-card", name: "Echo Show clock and agenda", description: "Clock, calendar focus and CO₂ corner indicator", preview: false, documentationURL: "https://github.com/makkus/echo-show-card#installation" });
}
