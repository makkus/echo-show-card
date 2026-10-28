// Home Assistant clock, agenda and CO2 card. No runtime dependencies.
export const DEFAULT_CO2_ENTITY = "";
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

export function displayEvents(events, now) {
  const timed = events.filter((event) => !event.allDay);
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

export function co2Reading(state, connected = true) {
  const raw = state?.state;
  const unit = state?.attributes?.unit_of_measurement;
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!connected || !Number.isFinite(value) || value < 0 || (unit && unit !== "ppm")) {
    return { band: "neutral", label: "CO₂ unavailable" };
  }
  return {
    band: value > 1000 ? "red" : value >= 600 ? "yellow" : "neutral",
    // Preserve fractional readings so a red 1000.1 is not labeled 1000.
    label: `CO₂ ${raw.trim()} ppm`,
  };
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
    --bg:#151c24; --ink:#f0f3f6; --muted:#acb6c2; --line:#ffffff22;
    --pad:clamp(22px,4vw,60px); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  :host([data-co2="yellow"]) { --bg:#e5c76b; --ink:#282617; --muted:#5d512c; --line:#28261733; }
  :host([data-co2="red"]) { --bg:#af4d47; --ink:#fff8f4; --muted:#f6d9d3; --line:#fff8f444; }
  * { box-sizing:border-box; }
  .display { height:100%; width:100%; overflow:hidden; background:var(--bg); color:var(--ink);
    display:flex; flex-direction:column; padding:var(--pad); }
  .layout { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,2fr) minmax(0,1fr); align-items:center; }
  :host([data-focus]) .layout { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .clock { text-align:center; min-width:0; padding-right:var(--pad); }
  .time { display:block; font-size:clamp(64px,15vw,216px); font-weight:350; line-height:1.1;
    letter-spacing:-.055em; font-variant-numeric:tabular-nums; white-space:nowrap; }
  :host([data-focus]) .time { font-size:clamp(54px,12.5vw,180px); }
  .date { margin-top:18px; color:var(--muted); font-size:clamp(14px,1.8vw,26px); }
  .agenda, .focus { min-width:0; padding-left:var(--pad); border-left:1px solid var(--line); }
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
  .empty { color:var(--muted); font-size:clamp(14px,1.7vw,24px); line-height:1.5; }
  footer { flex:none; margin-top:24px; display:flex; align-items:center; gap:10px;
    color:var(--muted); font-size:clamp(12px,1.3vw,19px); font-variant-numeric:tabular-nums; }
  .dot { height:7px; width:7px; border-radius:50%; background:currentColor; }
  @media (max-height:550px) { .display { padding-top:22px; padding-bottom:16px; }
    h2 { margin-bottom:16px; } li + li { margin-top:10px; }
    .title { -webkit-line-clamp:2; } footer { margin-top:14px; } .date { margin-top:10px; } }
`;

const ElementBase = globalThis.HTMLElement ?? class {};

export class EchoShowCard extends ElementBase {
  constructor() {
    super();
    this._events = [];
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
    this._config = { ...config, co2_entity: config.co2_entity || DEFAULT_CO2_ENTITY };
    this._invalidate("loading");
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

  _render() {
    if (!this._config || !this.isConnected) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>${STYLES}</style>
        <section class="display" aria-label="Clock and calendar">
          <main class="layout">
            <section class="clock" aria-label="Current time"><time class="time"></time><div class="date"></div></section>
            <section class="agenda" aria-label="Upcoming events"><h2>Coming up</h2><ul></ul><div class="empty"></div></section>
            <section class="focus" aria-label="Focus event" hidden><h1 class="focus-title clamp"></h1><p class="focus-status"></p></section>
          </main>
          <footer><span class="dot" aria-hidden="true"></span><span class="co2"></span></footer>
        </section>`;
    }
    const now = this._now();
    const timeZone = this._timeZone();
    const text = (selector, value) => {
      const element = this.shadowRoot.querySelector(selector);
      if (element.textContent !== value) element.textContent = value;
    };
    text(".time", formatter(timeZone, "clock").format(now));
    text(".date", formatter(timeZone, "date").format(now));
    const co2 = co2Reading(this._hass?.states?.[this._config.co2_entity], this._hass?.connected === true);
    this.dataset.co2 = co2.band;
    text(".co2", co2.label);
    const usable = this._status === "ready" && this._calendarAvailable();
    const model = displayEvents(usable ? this._events : [], now);
    this.toggleAttribute("data-focus", Boolean(model.focus));
    this.shadowRoot.querySelector(".agenda").hidden = Boolean(model.focus);
    this.shadowRoot.querySelector(".focus").hidden = !model.focus;
    if (model.focus) {
      text(".focus-title", model.focus.events.map((event) => event.title).join(" / "));
      text(".focus-status", model.focus.status);
    } else {
      text(".focus-title", "");
      text(".focus-status", "");
      const items = model.agenda.map((event) => ({ title: event.title, when: agendaWhen(event, now, timeZone) }));
      const key = JSON.stringify(items);
      if (key !== this._agendaKey) {
        this._agendaKey = key;
        const list = this.shadowRoot.querySelector("ul");
        list.replaceChildren(...items.map((item) => {
          const row = document.createElement("li");
          const when = document.createElement("div");
          when.className = "when";
          when.textContent = item.when;
          const title = document.createElement("div");
          title.className = "title clamp";
          title.textContent = item.title;
          row.append(when, title);
          return row;
        }));
      }
      const message = !this._config.calendar ? "Choose a calendar" : usable ? "No upcoming events" : this._status === "loading" && this._calendarAvailable() ? "Loading calendar…" : "Calendar unavailable";
      text(".empty", items.length ? "" : message);
    }
  }
}

class EchoShowCardEditor extends ElementBase {
  setConfig(config) { this._config = { co2_entity: DEFAULT_CO2_ENTITY, ...config }; this._render(); }
  set hass(hass) { this._hass = hass; this._render(); }
  connectedCallback() { this._render(); }

  _render() {
    if (!this._config || !this._hass || !this.isConnected) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>
        :host { display:block; padding:16px; font:inherit; }
        label { display:block; margin-bottom:20px; }
        select,input { display:block; width:100%; margin-top:8px; padding:12px; font:inherit;
          color:var(--primary-text-color); background:var(--card-background-color); border:1px solid #888; border-radius:6px; }
      </style><label>Main personal calendar<select></select></label>
      <label>CO₂ sensor<input list="co2-sensors"><datalist id="co2-sensors"></datalist></label>`;
      this.shadowRoot.querySelector("select").addEventListener("change", (event) => this._change("calendar", event.target.value));
      this.shadowRoot.querySelector("input").addEventListener("change", (event) => this._change("co2_entity", event.target.value));
    }
    const states = this._hass.states || {};
    const calendars = Object.keys(states).filter((id) => id.startsWith("calendar.")).sort();
    if (this._config.calendar && !calendars.includes(this._config.calendar)) calendars.push(this._config.calendar);
    const sensors = Object.keys(states).filter((id) => id.startsWith("sensor.") && states[id]?.attributes?.unit_of_measurement === "ppm").sort();
    const optionsKey = JSON.stringify([calendars.map((id) => [id, states[id]?.attributes?.friendly_name]), sensors]);
    if (optionsKey !== this._optionsKey) {
      this._optionsKey = optionsKey;
      const option = (id, label) => { const el = document.createElement("option"); el.value = id; el.textContent = label; return el; };
      this.shadowRoot.querySelector("select").replaceChildren(option("", "Choose a calendar"), ...calendars.map((id) => option(id, states[id]?.attributes?.friendly_name || id)));
      this.shadowRoot.querySelector("datalist").replaceChildren(...sensors.map((id) => option(id, id)));
    }
    this.shadowRoot.querySelector("select").value = this._config.calendar || "";
    const input = this.shadowRoot.querySelector("input");
    if (this.shadowRoot.activeElement !== input) input.value = this._config.co2_entity;
  }

  _change(key, value) {
    this._config = { ...this._config, [key]: value };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
}

if (globalThis.customElements && !customElements.get("echo-show-card")) {
  customElements.define("echo-show-card", EchoShowCard);
  customElements.define("echo-show-card-editor", EchoShowCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "echo-show-card", name: "Echo Show clock and agenda", description: "Clock, calendar focus and CO₂ background", preview: false, documentationURL: "https://github.com/makkus/echo-show-card#installation" });
}
