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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
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

  // Custom settings affect only the corner indicator. Even a legacy normal color
  // cannot recolor the panel or reveal the indicator for normal readings.
  await scenario("agenda");
  await page.evaluate(() => {
    const card = window.echoPreview.card;
    card.setConfig({ ...card._config, co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5,
      co2_normal_color: "#ffffff", co2_warning_color: "#000000", co2_critical_color: "#ffff00" });
  });
  const appearance = async () => page.evaluate(() => {
    const root = window.echoPreview.card.shadowRoot;
    const panel = getComputedStyle(root.querySelector(".calendar-panel"));
    const shape = getComputedStyle(root.querySelector(".co2-shape"));
    return { background: panel.backgroundColor, ink: panel.color,
      indicator: shape.fill, opacity: Number(shape.opacity),
      size: new DOMMatrixReadOnly(shape.transform).a,
      clock: getComputedStyle(root.querySelector(".display")).backgroundColor,
      time: getComputedStyle(root.querySelector(".time")).color,
      date: getComputedStyle(root.querySelector(".date")).color };
  });
  for (const [value, band, color, fraction] of [
    ["700.49", "normal", null, 0],
    ["700.5", "warning", "rgb(0, 0, 0)", 700.5 / 2401],
    ["1200.5", "warning", "rgb(0, 0, 0)", 0.5],
    ["1200.51", "critical", "rgb(255, 255, 0)", 1200.51 / 2401],
    ["2401", "critical", "rgb(255, 255, 0)", 1],
    ["10000", "critical", "rgb(255, 255, 0)", 1],
    ["unavailable", "unavailable", null, 0],
  ]) {
    await page.evaluate((reading) => {
      const card = window.echoPreview.card;
      card._hass.states[card._config.co2_entity].state = reading;
      card.hass = { ...card._hass };
    }, value);
    assert.equal(await card.getAttribute("data-co2"), band);
    const actual = await appearance();
    const { indicator, opacity, size, ...base } = actual;
    assert.deepEqual(base, { background: "rgb(21, 28, 36)", ink: "rgb(240, 243, 246)", clock: "rgb(21, 28, 36)", time: "rgb(240, 243, 246)", date: "rgb(172, 182, 194)" });
    assert.equal(opacity, color ? 1 : 0);
    if (color) assert.equal(indicator, color);
    assert.ok(Math.abs(size - fraction) < 0.00001, `growth fraction for ${value}`);
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
    card.setConfig({ ...card._config, co2_warning_threshold: 650, co2_warning_color: "#ffffff", co2_indicator_scale: 1.25 });
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
    editor.setConfig({ type: "custom:echo-show-card", calendar: "", co2_entity: "sensor.co2", extra_option: "preserve", co2_normal_color: "#abcdef" });
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
  const originalConfig = { type: "custom:echo-show-card", calendar: "calendar.personal", co2_entity: "sensor.co2", extra_option: "preserve", co2_normal_color: "#abcdef" };
  assert.deepEqual(await page.evaluate(() => window.editorConfig), originalConfig);
  const editor = page.locator("echo-show-card-editor");
  const warning = editor.locator('[data-setting="co2_warning_threshold"]');
  const critical = editor.locator('[data-setting="co2_critical_threshold"]');
  const warningHex = editor.locator('[data-setting="co2_warning_color"]');
  const scale = editor.locator('[data-setting="co2_indicator_scale"]');
  assert.equal(await warning.inputValue(), "600");
  assert.equal(await critical.inputValue(), "1000");
  assert.equal(await scale.inputValue(), "1");
  assert.equal(await editor.locator('[data-setting="co2_normal_color"]').count(), 0, "hidden normal state needs no color control");
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
  const beforeInvalidScale = await page.evaluate(() => window.editorChanges.length);
  for (const value of ["0.49", "1.51", ""]) {
    await scale.fill(value);
    assert.match(await editor.locator('[role="alert"]').textContent(), /scale.*0\.5.*1\.5/);
    assert.equal(await page.evaluate(() => window.editorChanges.length), beforeInvalidScale);
  }
  await scale.fill("0.5");
  assert.equal((await page.evaluate(() => window.editorConfig)).co2_indicator_scale, 0.5);
  await scale.fill("1.5");
  assert.equal((await page.evaluate(() => window.editorConfig)).co2_indicator_scale, 1.5);
  await scale.fill("1.25");
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
  await warningHex.fill("#ffffff");
  assert.equal(await editor.locator('[data-color-picker="co2_warning_color"]').inputValue(), "#ffffff");
  const changesBeforeBadColor = await page.evaluate(() => window.editorChanges.length);
  await warningHex.fill("red");
  assert.match(await editor.locator('[role="alert"]').textContent(), /#RRGGBB/);
  assert.equal(await page.evaluate(() => window.editorChanges.length), changesBeforeBadColor);
  await warningHex.fill("#abcdef");
  await editor.locator('[data-color-picker="co2_warning_color"]').fill("#123456");
  assert.equal(await editor.locator('[data-setting="co2_warning_color"]').inputValue(), "#123456");
  await editor.locator('[data-setting="co2_critical_color"]').fill("#000000");
  const customConfig = await page.evaluate(() => window.editorConfig);
  assert.deepEqual(customConfig, { ...originalConfig, co2_warning_threshold: 700.5, co2_critical_threshold: 1200.5,
    co2_warning_color: "#123456", co2_critical_color: "#000000", co2_indicator_scale: 1.25 });
  await page.evaluate((config) => document.querySelector("echo-show-card-editor").setConfig(JSON.parse(JSON.stringify(config))), customConfig);
  assert.equal(await warningHex.inputValue(), "#123456");
  assert.equal(await critical.inputValue(), "1200.5");
  assert.equal(await scale.inputValue(), "1.25");
  await warningHex.fill("invalid");
  await editor.locator("[data-reset]").click();
  const { co2_normal_color: legacyNormal, ...resetConfig } = originalConfig;
  assert.deepEqual(await page.evaluate(() => window.editorConfig), resetConfig);
  assert.equal(await warning.inputValue(), "600");
  assert.equal(await critical.inputValue(), "1000");
  assert.equal(await scale.inputValue(), "1");
  for (const [level, color] of [["warning", "#e5c76b"], ["critical", "#af4d47"]]) {
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
      assert.equal(geometry.background, "rgb(21, 28, 36)");
      if (width === 1280) {
        await page.screenshot({ path: `${shots}/${name}.png` });
      }
    }

    // Check the actual SVG circle after scaling and resizing, including behind text
    // at saturation. Its center must stay exactly at the panel's top-right corner.
    for (const name of ["agenda", "ongoing", "long"]) {
      for (const scale of [0.5, 1, 1.5]) {
        for (const reading of ["600", "1000", "2000", "3000", "500", "unavailable"]) {
          await page.evaluate(async ({ name, scale, reading }) => {
            document.querySelector("#scenario").value = name;
            document.querySelector("#co2").value = reading;
            document.querySelector("#scale").value = scale;
            await window.echoPreview.render();
          }, { name, scale, reading });
          const shape = await page.evaluate(() => {
            const root = window.echoPreview.card.shadowRoot;
            const svg = root.querySelector(".co2-indicator");
            const circle = root.querySelector(".co2-shape");
            const bounds = svg.getBoundingClientRect();
            const disk = circle.getBoundingClientRect();
            return { radius: disk.width / 2, height: disk.height, opacity: Number(getComputedStyle(circle).opacity),
              cornerX: disk.left + disk.width / 2 - bounds.right, cornerY: disk.top + disk.height / 2 - bounds.top,
              shorter: Math.min(bounds.width, bounds.height), pointerEvents: getComputedStyle(svg).pointerEvents,
              accessible: svg.getAttribute("aria-hidden") };
          });
          const visible = !["500", "unavailable"].includes(reading);
          const fraction = visible ? Math.min(Number(reading) / 2000, 1) : 0;
          assert.ok(Math.abs(shape.radius - shape.shorter * 0.6 * scale * fraction) < 0.1, `${width} ${name} ${reading} scale ${scale}: radius`);
          assert.ok(Math.abs(shape.height - 2 * shape.radius) < 0.1, "indicator must remain circular");
          assert.ok(Math.abs(shape.cornerX) < 0.1 && Math.abs(shape.cornerY) < 0.1, "quarter circle must stay anchored at the corner");
          assert.equal(shape.opacity, visible ? 1 : 0);
          assert.equal(shape.pointerEvents, "none");
          assert.equal(shape.accessible, "true", "the numerical reading supplies the accessible information");
          if (reading === "2000" && scale === 1.5) {
            await page.screenshot({ path: `${shots}/${name}-max-${width}.png` });
          }
        }
      }
    }
  }

  // A white custom indicator is the worst case for light text. Check the actual
  // text backing's composited contrast and keep Done usable at the largest size.
  await page.evaluate(async () => {
    document.querySelector("#scenario").value = "ongoing";
    await window.echoPreview.render();
    const card = window.echoPreview.card;
    card.setConfig({ ...card._config, co2_critical_color: "#ffffff", co2_indicator_scale: 1.5 });
    card._hass.states[card._config.co2_entity].state = "3000";
    card.hass = { ...card._hass };
  });
  const contrasts = await card.locator(".calendar-text").evaluateAll((spans) => {
    const luminance = (rgb) => rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    return spans.filter((span) => span.getBoundingClientRect().height && span.textContent).map((span) => {
      const style = getComputedStyle(span);
      const color = style.color.match(/[\d.]+/g).map(Number);
      const bg = style.backgroundColor.match(/[\d.]+/g).map(Number);
      const alpha = bg[3] ?? 1;
      const ink = luminance(color.slice(0, 3));
      const backing = luminance(bg.slice(0, 3).map((c) => c * alpha + 255 * (1 - alpha)));
      return (Math.max(ink, backing) + 0.05) / (Math.min(ink, backing) + 0.05);
    });
  });
  assert.ok(contrasts.length > 0 && contrasts.every((ratio) => ratio >= 4.5), "text must remain readable over the brightest custom indicator");
  await page.screenshot({ path: `${shots}/white-indicator-max.png` });
  await card.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await card.locator(".agenda").isVisible(), true);

  // Use a separate real-time page so CSS transitions run independently of the
  // mocked calendar clock. Verify movement between endpoints, then reduced motion.
  const motionPage = await browser.newPage({ reducedMotion: "no-preference" });
  motionPage.on("pageerror", (error) => errors.push(error.message));
  await motionPage.goto(url);
  await motionPage.waitForFunction(() => window.echoPreview?.card._status === "ready");
  const motionShape = motionPage.locator("echo-show-card .co2-shape");
  const motionState = () => motionShape.evaluate((circle) => {
    const style = getComputedStyle(circle);
    return { size: new DOMMatrixReadOnly(style.transform).a, opacity: Number(style.opacity), fill: style.fill, duration: style.transitionDuration };
  });
  assert.equal((await motionState()).size, 0);
  await motionPage.selectOption("#co2", "1200");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const moving = await motionState();
  assert.ok(moving.size > 0 && moving.size < 0.6, "radius should ease between readings");
  assert.ok(moving.opacity > 0 && moving.opacity < 1, "indicator should fade in without flashing");
  assert.equal(moving.duration, "1s, 1s, 1s");
  await new Promise((resolve) => setTimeout(resolve, 850));
  assert.equal((await motionState()).size, 0.6);
  assert.equal((await motionState()).fill, "rgb(175, 77, 71)");
  await motionPage.emulateMedia({ reducedMotion: "reduce" });
  await motionPage.selectOption("#co2", "2000");
  assert.equal((await motionState()).size, 1, "reduced motion applies growth immediately");
  assert.equal((await motionState()).duration, "0s");
  await motionPage.selectOption("#co2", "500");
  assert.equal((await motionState()).opacity, 0);
  assert.equal((await motionState()).size, 0);
  await motionPage.close();
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: calendar states/lifecycle/Done, safe text, custom CO₂ thresholds/colors, editor validation/reset, radius/scale/anchoring at 3 viewport sizes, text contrast, transitions and reduced motion. Screenshots: ${shots}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
