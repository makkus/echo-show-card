import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { startPreview } from "./serve-preview.mjs";

// Playwright is a development dependency; Home Assistant only needs the card file.
const { chromium } = await import(process.env.ECHO_PLAYWRIGHT_MODULE || "playwright");
const { server, url } = await startPreview();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.ECHO_CHROMIUM_PATH ? { executablePath: process.env.ECHO_CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-28T12:00:00+01:00") });
  await page.clock.pauseAt(new Date("2026-10-28T12:05:00+01:00"));
  await page.goto(url);
  await page.waitForFunction(() => window.echoPreview?.card._status === "ready");
  const card = page.locator("echo-show-card");
  const text = async (selector) => card.locator(selector).textContent();
  const scenario = async (name) => {
    await page.selectOption("#scenario", name);
    await page.waitForFunction(() => window.echoPreview.card._request === null);
  };
  assert.equal(await text(".time"), "12:05");
  assert.equal(await card.locator("li").count(), 5);
  assert.equal(await card.locator(".focus").isVisible(), false);

  for (const [value, band] of [["600", "yellow"], ["1000", "yellow"], ["1000.1", "red"], ["unavailable", "neutral"]]) {
    await page.selectOption("#co2", value);
    await page.waitForFunction((expected) => window.echoPreview.card.dataset.co2 === expected, band);
  }
  await scenario("countdown");
  assert.equal(await text(".focus-status"), "in 37 minutes");
  await scenario("ongoing");
  assert.equal(await text(".focus-status"), "ongoing");
  await scenario("overlap");
  assert.equal(await text(".focus-title"), "Quiet afternoon");
  await scenario("simultaneous");
  assert.match(await text(".focus-title"), /Call with Sam \/ Lunch with Alex/);
  await scenario("empty");
  assert.equal(await text(".empty"), "No upcoming events");
  await scenario("error");
  assert.equal(await text(".empty"), "Calendar unavailable");
  await page.selectOption("#co2", "1200");
  assert.equal(await card.getAttribute("data-co2"), "red");
  await scenario("offline");
  assert.equal(await text(".empty"), "Calendar unavailable");
  assert.equal(await text(".co2"), "CO₂ unavailable");
  assert.equal(await card.getAttribute("data-co2"), "neutral");

  // Titles are calendar data, never markup.
  await page.evaluate(async () => {
    const preview = window.echoPreview;
    preview.scenarios.long[0].summary = '<img src=x onerror="window.injected=true">';
    document.querySelector("#scenario").value = "long";
    await preview.render();
  });
  assert.match(await text(".focus-title"), /<img/);
  assert.equal(await card.locator("img").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);

  // Exercise authentication path, refresh boundaries, suspension, late responses,
  // failed reads and lifecycle against the real element rather than its helpers.
  await page.evaluate(() => {
    window.echoPreview.card.remove();
    const card = document.createElement("echo-show-card");
    const pending = [];
    const calls = [];
    const hass = {
      connected: true, config: { time_zone: "Europe/Berlin" },
      states: { "calendar.personal": { state: "off" }, "sensor.co2": { state: "900", attributes: { unit_of_measurement: "ppm" } } },
      callApi: (method, path) => { calls.push({ method, path }); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    };
    window.cardCheck = { card, hass, calls, pending };
    card.setConfig({ calendar: "calendar.personal", co2_entity: "sensor.co2" });
    card.hass = hass;
    document.body.append(card);
  });
  assert.equal(await page.evaluate(() => window.cardCheck.calls.length), 1);
  const query = await page.evaluate(() => window.cardCheck.calls[0]);
  assert.equal(query.method, "GET");
  assert.match(query.path, /^calendars\/calendar.personal\?/);
  const params = new URL(`http://example/${query.path}`).searchParams;
  assert.equal(Date.parse(params.get("end")) - Date.parse(params.get("start")), 7 * 86_400_000);
  await page.evaluate(() => {
    const { pending } = window.cardCheck;
    pending.shift().resolve([{ summary: "Real element test", start: { dateTime: new Date(Date.now() + 120_000).toISOString() }, end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() } }]);
  });
  await page.waitForFunction(() => window.cardCheck.card._status === "ready");
  await page.clock.fastForward(60_000);
  assert.equal(await page.evaluate(() => window.cardCheck.calls.length), 2);
  assert.equal(await page.locator("echo-show-card .focus-status").textContent(), "in 1 minute");
  await page.clock.fastForward(15_000);
  assert.equal(await page.locator("echo-show-card .empty").textContent(), "Calendar unavailable");
  await page.evaluate(() => window.cardCheck.pending.shift().resolve([]));
  assert.equal(await page.evaluate(() => window.cardCheck.card._status), "unavailable");

  // A fresh read after a reconnect must not accept a response from before it.
  await page.evaluate(() => {
    const check = window.cardCheck;
    check.card.hass = { ...check.hass, connected: false };
    check.card.hass = check.hass;
    check.card.setConfig({ calendar: "calendar.personal", co2_entity: "sensor.co2" });
    check.pending.shift().resolve([{ summary: "Stale", start: { dateTime: new Date(Date.now()).toISOString() }, end: { dateTime: new Date(Date.now() + 3_600_000).toISOString() } }]);
    check.pending.shift().resolve([]);
  });
  await page.waitForFunction(() => window.cardCheck.card._status === "ready");
  assert.equal(await page.locator("echo-show-card .empty").textContent(), "No upcoming events");

  // Resume after sleeping: stale cached events are removed before a new read.
  await page.evaluate(() => { window.cardCheck.card._events = [{ start: Date.now() - 10_000, end: Date.now() + 3_600_000, allDay: false, title: "Old cached event" }]; });
  await page.clock.setSystemTime(new Date("2026-10-28T13:00:00+01:00"));
  await page.evaluate(() => window.cardCheck.card._tick());
  assert.equal(await page.locator("echo-show-card .empty").textContent(), "Calendar unavailable");
  await page.evaluate(() => window.cardCheck.card.remove());
  const callsAfterDetach = await page.evaluate(() => window.cardCheck.calls.length);
  await page.clock.fastForward(120_000);
  assert.equal(await page.evaluate(() => window.cardCheck.calls.length), callsAfterDetach);

  // The visual editor preserves config and emits the supported config-changed event.
  await page.evaluate(async () => {
    const { EchoShowCard } = await import("/echo-show-card.js");
    const editor = EchoShowCard.getConfigElement();
    editor.setConfig({ type: "custom:echo-show-card", calendar: "", co2_entity: "sensor.co2" });
    editor.hass = { states: { "calendar.personal": { state: "off", attributes: { friendly_name: "My calendar" } } } };
    editor.addEventListener("config-changed", (event) => { window.editorConfig = event.detail.config; });
    document.body.append(editor);
  });
  await page.locator("echo-show-card-editor select").selectOption("calendar.personal");
  assert.deepEqual(await page.evaluate(() => window.editorConfig), { type: "custom:echo-show-card", calendar: "calendar.personal", co2_entity: "sensor.co2" });

  // Viewport/overflow checks and screenshots contain only the synthetic preview.
  await page.goto(url);
  await page.waitForFunction(() => window.echoPreview?.card._status === "ready");
  await page.addStyleTag({ content: "header { display:none !important; }" });
  const shots = process.env.ECHO_SCREENSHOT_DIR || "/tmp/echo-show-dashboard";
  await mkdir(shots, { recursive: true });
  for (const [width, height] of [[1280, 800], [960, 600], [800, 480]]) {
    await page.setViewportSize({ width, height });
    for (const name of ["agenda", "countdown", "ongoing", "long"]) {
      await page.evaluate(async (scenarioName) => { document.querySelector("#scenario").value = scenarioName; await window.echoPreview.render(); window.echoPreview.card._fitHeight(); }, name);
      const overflow = await page.evaluate(() => {
        const card = window.echoPreview.card;
        const root = card.shadowRoot;
        const display = root.querySelector(".display").getBoundingClientRect();
        const visible = [...root.querySelectorAll(".time,.date,li,.focus-title,.focus-status,footer")].filter((el) => el.getBoundingClientRect().height > 0);
        return visible.filter((el) => { const box = el.getBoundingClientRect(); return box.right > display.right + 1 || box.bottom > display.bottom + 1 || box.left < display.left - 1 || (el.classList.contains("time") && el.scrollWidth > el.clientWidth + 1); }).map((el) => el.className);
      });
      assert.deepEqual(overflow, [], `${width}×${height} ${name} overflows: ${overflow}`);
      if (width === 1280) {
        await page.evaluate(async (value) => { document.querySelector("#co2").value = value; await window.echoPreview.render(); }, name === "countdown" ? "800" : name === "ongoing" ? "1200" : "500");
        await page.screenshot({ path: `${shots}/${name}.png` });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: states, refresh/timeout/reconnect, safe text, editor, 3 viewport sizes. Screenshots: ${shots}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
