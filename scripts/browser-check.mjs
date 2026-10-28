import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { startPreview } from "./serve-preview.mjs";

// Playwright is a development dependency; Home Assistant only needs the card file.
const { chromium } = await import(process.env.ECHO_PLAYWRIGHT_MODULE || "playwright");
const { server, url } = await startPreview();
const shots = process.env.ECHO_SCREENSHOT_DIR || "/tmp/echo-show-dashboard";
let browser;
try {
  await mkdir(shots, { recursive: true });
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

  for (const [value, band] of [["600", "warning"], ["1000", "warning"], ["1000.1", "critical"], ["unavailable", "unavailable"]]) {
    await page.selectOption("#co2", value);
    await page.waitForFunction((expected) => window.echoPreview.card.dataset.co2 === expected, band);
  }
  await scenario("countdown");
  assert.equal(await text(".focus-status"), "in 37 minutes");
  assert.equal(await card.getByRole("button", { name: "Done", exact: true }).isVisible(), false);
  await scenario("ongoing");
  assert.equal(await text(".focus-status"), "ongoing");
  await card.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await card.locator(".agenda").isVisible(), true);
  assert.equal(await card.getAttribute("data-focus"), null);
  assert.equal(await card.locator("li").count(), 5);
  await page.evaluate(() => window.echoPreview.render());
  assert.equal(await card.locator(".focus").isVisible(), false, "refresh must preserve dismissal");
  await scenario("offline");
  await scenario("ongoing");
  assert.equal(await card.locator(".focus").isVisible(), false, "reconnect must preserve dismissal");
  await page.reload();
  await page.waitForFunction(() => window.echoPreview?.card._status === "ready");
  await scenario("ongoing");
  assert.equal(await card.getByRole("button", { name: "Done", exact: true }).isVisible(), true, "reload resets dismissals");
  await scenario("overlap");
  assert.equal(await text(".focus-title"), "Quiet afternoon");
  await card.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await text(".focus-title"), "Team catch-up");
  assert.equal(await text(".focus-status"), "in 10 minutes");
  assert.equal(await card.getByRole("button", { name: "Done", exact: true }).isVisible(), false);
  await scenario("simultaneous");
  assert.match(await text(".focus-title"), /Call with Sam \/ Lunch with Alex/);
  await page.evaluate(async () => {
    document.querySelector("#offset").value = "25";
    await window.echoPreview.render();
  });
  await card.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await card.locator(".agenda").isVisible(), true, "Done dismisses the entire displayed group using the keyboard");
  await page.evaluate(async () => {
    document.querySelector("#offset").value = "0";
    await window.echoPreview.render();
  });
  await scenario("empty");
  assert.equal(await text(".empty"), "No upcoming events");
  await scenario("error");
  assert.equal(await text(".empty"), "Calendar unavailable");
  await page.selectOption("#co2", "1200");
  assert.equal(await card.getAttribute("data-co2"), "critical");
  await scenario("offline");
  assert.equal(await text(".empty"), "Calendar unavailable");
  assert.equal(await text(".co2"), "CO₂ unavailable");
  assert.equal(await card.getAttribute("data-co2"), "unavailable");

  // Custom settings change the calendar background and contrast, keeping the clock dark.
  await scenario("agenda");
  await page.evaluate(() => {
    const card = window.echoPreview.card;
    card.setConfig({ ...card._config, co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5,
      co2_normal_color: "#ffffff", co2_warning_color: "#000000", co2_critical_color: "#ffff00" });
  });
  const appearance = async () => page.evaluate(() => {
    const root = window.echoPreview.card.shadowRoot;
    const panel = getComputedStyle(root.querySelector(".calendar-panel"));
    return { background: panel.backgroundColor, ink: panel.color,
      clock: getComputedStyle(root.querySelector(".display")).backgroundColor,
      time: getComputedStyle(root.querySelector(".time")).color,
      date: getComputedStyle(root.querySelector(".date")).color };
  });
  for (const [value, band, background, ink] of [
    ["700.49", "normal", "rgb(255, 255, 255)", "rgb(0, 0, 0)"],
    ["700.5", "warning", "rgb(0, 0, 0)", "rgb(255, 255, 255)"],
    ["1200.5", "warning", "rgb(0, 0, 0)", "rgb(255, 255, 255)"],
    ["1200.51", "critical", "rgb(255, 255, 0)", "rgb(0, 0, 0)"],
    ["unavailable", "unavailable", "rgb(21, 28, 36)", "rgb(255, 255, 255)"],
  ]) {
    await page.evaluate((reading) => {
      const card = window.echoPreview.card;
      card._hass.states[card._config.co2_entity].state = reading;
      card.hass = { ...card._hass };
    }, value);
    assert.equal(await card.getAttribute("data-co2"), band);
    assert.deepEqual(await appearance(), { background, ink, clock: "rgb(21, 28, 36)", time: "rgb(240, 243, 246)", date: "rgb(172, 182, 194)" });
    assert.equal(await card.locator("li").count(), 5);
  }

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
  await page.evaluate(() => {
    const card = window.cardCheck.card;
    card.setConfig({ ...card._config, co2_warning_threshold: 650, co2_warning_color: "#ffffff" });
  });
  assert.equal(await page.evaluate(() => window.cardCheck.calls.length), 1, "presentation edits must not refetch the calendar");
  assert.equal(await page.locator("echo-show-card .focus-title").textContent(), "Real element test");
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
    check.card._tick(true);
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
    editor.setConfig({ type: "custom:echo-show-card", calendar: "", co2_entity: "sensor.co2", extra_option: "preserve" });
    editor.hass = { states: { "calendar.personal": { state: "off", attributes: { friendly_name: "My calendar" } } } };
    window.editorChanges = [];
    editor.addEventListener("config-changed", (event) => {
      window.editorConfig = event.detail.config;
      window.editorChanges.push(event.detail.config);
      // Simulate Home Assistant passing the emitted configuration back to the editor.
      editor.setConfig(event.detail.config);
    });
    document.body.append(editor);
  });
  await page.locator("echo-show-card-editor select").selectOption("calendar.personal");
  const originalConfig = { type: "custom:echo-show-card", calendar: "calendar.personal", co2_entity: "sensor.co2", extra_option: "preserve" };
  assert.deepEqual(await page.evaluate(() => window.editorConfig), originalConfig);
  const editor = page.locator("echo-show-card-editor");
  const warning = editor.locator('[data-setting="co2_warning_threshold"]');
  const critical = editor.locator('[data-setting="co2_critical_threshold"]');
  const normalHex = editor.locator('[data-setting="co2_normal_color"]');
  assert.equal(await warning.inputValue(), "600");
  assert.equal(await critical.inputValue(), "1000");
  await warning.fill("700.5");
  assert.equal((await page.evaluate(() => window.editorConfig)).co2_warning_threshold, 700.5);
  const changesBeforeInvalid = await page.evaluate(() => window.editorChanges.length);
  await critical.fill("700.5");
  assert.equal(await editor.locator('[role="alert"]').isVisible(), true);
  assert.match(await editor.locator('[role="alert"]').textContent(), /below/);
  await page.evaluate(() => { const editor = document.querySelector("echo-show-card-editor"); editor.hass = { ...editor._hass }; });
  assert.equal(await critical.inputValue(), "700.5", "HA updates must preserve invalid drafts");
  await critical.fill("-1");
  await critical.fill("");
  assert.equal(await page.evaluate(() => window.editorChanges.length), changesBeforeInvalid);
  await critical.fill("1200.5");
  assert.equal(await editor.locator('[role="alert"]').isVisible(), false);
  await page.setViewportSize({ width: 400, height: 1200 });
  const editorOverflow = await editor.evaluate((element) => {
    const boundary = element.getBoundingClientRect();
    return [...element.shadowRoot.querySelectorAll("input,select,button,fieldset")].some((control) => {
      const box = control.getBoundingClientRect();
      return box.left < boundary.left || box.right > boundary.right;
    });
  });
  assert.equal(editorOverflow, false, "editor controls must fit a narrow dashboard dialog");
  await editor.screenshot({ path: `${shots}/editor.png` });
  await normalHex.fill("#ffffff");
  assert.equal(await editor.locator('[data-color-picker="co2_normal_color"]').inputValue(), "#ffffff");
  const changesBeforeBadColor = await page.evaluate(() => window.editorChanges.length);
  await normalHex.fill("red");
  assert.match(await editor.locator('[role="alert"]').textContent(), /#RRGGBB/);
  assert.equal(await page.evaluate(() => window.editorChanges.length), changesBeforeBadColor);
  await normalHex.fill("#abcdef");
  await editor.locator('[data-color-picker="co2_warning_color"]').fill("#123456");
  assert.equal(await editor.locator('[data-setting="co2_warning_color"]').inputValue(), "#123456");
  await editor.locator('[data-setting="co2_critical_color"]').fill("#000000");
  const customConfig = await page.evaluate(() => window.editorConfig);
  assert.deepEqual(customConfig, { ...originalConfig, co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5,
    co2_normal_color: "#abcdef", co2_warning_color: "#123456", co2_critical_color: "#000000" });
  await page.evaluate((config) => document.querySelector("echo-show-card-editor").setConfig(JSON.parse(JSON.stringify(config))), customConfig);
  assert.equal(await normalHex.inputValue(), "#abcdef");
  assert.equal(await critical.inputValue(), "1200.5");
  await normalHex.fill("invalid");
  await editor.locator("[data-reset]").click();
  assert.deepEqual(await page.evaluate(() => window.editorConfig), originalConfig);
  assert.equal(await warning.inputValue(), "600");
  assert.equal(await critical.inputValue(), "1000");
  for (const [level, color] of [["normal", "#151c24"], ["warning", "#e5c76b"], ["critical", "#af4d47"]]) {
    assert.equal(await editor.locator(`[data-setting="co2_${level}_color"]`).inputValue(), color);
    assert.equal(await editor.locator(`[data-color-picker="co2_${level}_color"]`).inputValue(), color);
  }
  assert.equal(await editor.locator('[role="alert"]').isVisible(), false);

  // Viewport/overflow checks and screenshots contain only the synthetic preview.
  await page.goto(url);
  await page.waitForFunction(() => window.echoPreview?.card._status === "ready");
  await page.addStyleTag({ content: "header { display:none !important; }" });
  for (const [width, height] of [[1280, 800], [960, 600], [800, 480]]) {
    await page.setViewportSize({ width, height });
    for (const name of ["agenda", "countdown", "ongoing", "long", "long-ongoing", "empty", "error", "offline"]) {
      await page.evaluate(async (scenarioName) => {
        document.querySelector("#scenario").value = scenarioName === "long-ongoing" ? "long" : scenarioName;
        document.querySelector("#offset").value = scenarioName === "long-ongoing" ? "30" : "0";
        document.querySelector("#co2").value = scenarioName === "ongoing" ? "1200" : "800";
        await window.echoPreview.render();
        window.echoPreview.card._fitHeight();
      }, name);
      const overflow = await page.evaluate(() => {
        const card = window.echoPreview.card;
        const root = card.shadowRoot;
        const display = root.querySelector(".display").getBoundingClientRect();
        const visible = [...root.querySelectorAll(".time,.date,li,.focus-title,.focus-status,.done,footer")].filter((el) => el.getBoundingClientRect().height > 0);
        return visible.filter((el) => {
          const box = el.getBoundingClientRect();
          const container = root.querySelector(el.closest(".calendar-panel") ? ".calendar-panel" : ".clock").getBoundingClientRect();
          return box.right > container.right + 1 || box.bottom > display.bottom + 1 || box.left < container.left - 1 || box.top < display.top - 1 ||
            (el.classList.contains("time") && el.scrollWidth > el.clientWidth + 1);
        }).map((el) => el.className);
      });
      assert.deepEqual(overflow, [], `${width}×${height} ${name} overflows: ${overflow}`);
      const geometry = await page.evaluate(() => {
        const root = window.echoPreview.card.shadowRoot;
        const display = root.querySelector(".display").getBoundingClientRect();
        const panel = root.querySelector(".calendar-panel").getBoundingClientRect();
        const footer = root.querySelector("footer").getBoundingClientRect();
        const done = root.querySelector(".done").getBoundingClientRect();
        const panelStyle = getComputedStyle(root.querySelector(".calendar-panel"));
        return { width: panel.width / display.width, top: panel.top - display.top, right: display.right - panel.right,
          bottom: display.bottom - panel.bottom, footerGap: panel.bottom - footer.bottom,
          bottomPadding: parseFloat(panelStyle.paddingBottom), footerInside: footer.left >= panel.left && footer.right <= panel.right,
          doneHeight: done.height, doneAboveFooter: done.bottom <= footer.top,
          background: panelStyle.backgroundColor, clock: getComputedStyle(root.querySelector(".display")).backgroundColor };
      });
      const focused = ["countdown", "ongoing", "long", "long-ongoing"].includes(name);
      if (["ongoing", "long-ongoing"].includes(name)) {
        assert.ok(geometry.doneHeight >= 48, "Done must have a usable touch target");
        assert.equal(geometry.doneAboveFooter, true, "Done must not overlap the CO₂ footer");
      }
      assert.ok(Math.abs(geometry.width - (focused ? 1 / 2 : 1 / 3)) < 0.002, `${name} calendar panel width`);
      for (const edge of ["top", "right", "bottom"]) assert.ok(Math.abs(geometry[edge]) < 1, `${name} panel must fill ${edge} edge`);
      assert.ok(Math.abs(geometry.footerGap - geometry.bottomPadding) < 1, "CO₂ footer must stay at panel bottom");
      assert.equal(geometry.footerInside, true);
      assert.equal(geometry.clock, "rgb(21, 28, 36)");
      assert.equal(geometry.background, name === "offline" ? "rgb(21, 28, 36)" : name === "ongoing" ? "rgb(175, 77, 71)" : "rgb(229, 199, 107)");
      if (width === 1280) {
        await page.screenshot({ path: `${shots}/${name}.png` });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: states, Done dismissal/refresh/reconnect/reload/keyboard, refresh/timeout/reconnect, safe text, custom CO₂ settings/contrast, editor validation/reset, panel geometry at 3 viewport sizes. Screenshots: ${shots}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
