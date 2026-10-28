# Echo Show clock and agenda

A Home Assistant card for a quiet kiosk display: a large clock, an upcoming calendar agenda,
and an event countdown that becomes an ongoing-event display. A filled circle at a configurable
position across the card changes color and grows with CO2 while the background stays
dark. Up to four sensor readings sit below the clock, and calendar text aligns near the bottom.
Originally designed for an Echo Show 8
running an Android kiosk browser; it can be used in other Home Assistant browsers too.


## Installation

Requires Home Assistant **2026.10.4 or newer**, a calendar integration exposing a `calendar.*`
entity, and a browser with modern JavaScript support. For the CO₂ indicator, select a
CO2 sensor reporting in **ppm**. There are no runtime dependencies or separate credentials.
The card uses the existing Home Assistant user's read access to the selected entities.

### HACS

1. Open **HACS → ⋮ → Custom repositories**.
2. Add `https://github.com/makkus/echo-show-card` with type **Dashboard**.
3. Find **Echo Show clock and agenda**, download it, then reload the browser.
4. Check **Settings → Dashboards → ⋮ → Resources**. If HACS has not registered the card,
   add `/hacsfiles/echo-show-card/echo-show-card.js` as a **JavaScript module**. Advanced
   mode in your user profile may be needed to see Resources. Avoid duplicate resource entries.
5. Create the dashboard below and select your entities in the card's visual editor.

The repository must contain the published files on GitHub before installation works. The
default branch can be installed before the first release; later, use versioned releases.
Adding a custom repository does not require inclusion in HACS's default catalog.
See [HACS custom repositories](https://www.hacs.xyz/docs/faq/custom_repositories/).

### Manual installation

1. Download `echo-show-card.js` from this repository or a release and copy it to
   `/config/www/echo-show-card/echo-show-card.js`.
2. Add `/local/echo-show-card/echo-show-card.js?v=0.1.0` under dashboard Resources with type
   **JavaScript module**, then reload the browser.
3. Create the dashboard below. When updating manually, replace the file, change the version
   query in the resource URL, and reload the kiosk browser.

If `www` was first created after Home Assistant started, a Core restart may be needed for
the `/local/` route. Check that the JavaScript URL loads before scheduling that interruption.
When switching from a manual install to HACS, retain only the resource for the chosen
installation so the browser loads one copy of the card.

## Create the dashboard

1. Open **Settings → Dashboards → Add dashboard → New dashboard from scratch**. Use a
   title such as **Echo Show** and URL path **echo-show**. Allow the kiosk user to access it.
2. Open the new dashboard, edit it, and apply [examples/dashboard.yaml](examples/dashboard.yaml)
   through the **Raw configuration editor**. This sets a panel view containing exactly one card.
3. Open the card's visual editor. Choose your main calendar and enter or select the CO2 sensor.
   Under **CO₂ warnings**, adjust the two ppm thresholds, warning and critical colors, and
   indicator scale and center coordinates if desired. Under **Sensor values**, add up to four sensor
   readings, give them optional labels, and reorder them.
   Save, then check the live event list and numerical reading against Home Assistant.
4. Open `/echo-show/clock` on your kiosk. Record its current start URL before changing it.
   Assign this dashboard as the new kiosk start URL once it renders correctly.

The card fills the viewport below its own top edge. Home Assistant header/sidebar visibility
is controlled by your kiosk configuration. Brightness, screen sleep, voice and audio settings
remain under your existing kiosk controls.

To add it to an existing view, select **Echo Show clock and agenda** in the card picker. For
the intended full-screen layout, use a panel view with one card. The minimal card configuration is:

```yaml
type: custom:echo-show-card
calendar: ""
co2_entity: ""
```

Select the actual entities in the visual editor after adding the card. With an empty calendar,
it displays “Choose a calendar”. An empty CO2 sensor hides the indicator and provides no
default sensor reading.

| Option | Purpose | Default |
| --- | --- | --- |
| `type` | `custom:echo-show-card` | Required |
| `calendar` | One calendar entity to display | Unset |
| `co2_entity` | Sensor with a numerical ppm reading | Unset |
| `values` | Ordered list of up to four sensor readings with optional labels; `[]` hides the section | Selected CO₂ sensor, if any |
| `co2_warning_threshold` | Warning starts at this reading, in ppm | `600` |
| `co2_critical_threshold` | Critical starts strictly above this reading, in ppm | `1000` |
| `co2_warning_color` | Indicator from warning through critical threshold, inclusive | `"#e5c76b"` |
| `co2_critical_color` | Indicator above the critical threshold | `"#af4d47"` |
| `co2_indicator_scale` | Maximum-radius multiplier, from `0.5` to `1.5` | `1` |
| `co2_indicator_x` | Circle center horizontally across the full card, from `0` to `100` percent | `100` (right edge) |
| `co2_indicator_y` | Circle center vertically down the full card, from `0` to `100` percent | `0` (top edge) |
| `co2_indicator_corner` | Legacy corner default for omitted coordinate axes: `top-right`, `top-left`, `bottom-left`, or `bottom-right`, now relative to the full card | `"top-right"` |
| `co2_normal_color` | Legacy color, accepted for compatibility; normal readings hide the indicator | `"#151c24"` |

The thresholds, two indicator colors, scale, and center coordinates are available in the card's visual editor.
Colors have a picker and an editable six-digit hex value (`#RRGGBB`). The panel stays dark,
with dark backing behind calendar text, the clock/date, and readings to keep them readable when the indicator overlaps them.
Thresholds accept nonnegative, finite numbers, including fractions, and the warning threshold
must be strictly below the critical threshold. Scale accepts finite numbers from `0.5` through
`1.5`, including fractions. Invalid entries show an error and do not update the applied
configuration. Coordinates accept finite numbers from `0` through `100`, including fractions.
**Reset CO₂ settings** restores the thresholds, colors, scale, and position (`100 / 0`) while
preserving entity selections and the explicit readings list. The legacy normal-color setting is accepted in YAML but has
no visual effect and is omitted from the editor.

These options also work in YAML; quote hex colors so YAML does not treat them as comments:

```yaml
type: custom:echo-show-card
calendar: calendar.personal
co2_entity: sensor.co2
co2_warning_threshold: 700
co2_critical_threshold: 1200
co2_warning_color: "#e5c76b"
co2_critical_color: "#af4d47"
co2_indicator_scale: 1
co2_indicator_x: 0
co2_indicator_y: 0
values:
  - entity: sensor.co2
    label: CO₂
  - entity: sensor.room_temperature
    label: Room temperature
```

Omitted settings use their defaults, so existing dashboard configurations continue to work.

Coordinates locate the **circle's center across the whole card**, including the clock region.
`0 / 0` is the card's top-left corner and displays a quarter circle; `50 / 0` places it at
the middle of the top edge and can show a half circle. `50 / 50` is the center of the card
and can show the whole circle when its radius fits. `100 / 100` is bottom-right. Only the
card edges clip it; it can cross the column divider. Use **Circle center X (%)** and
**Circle center Y (%)** in the visual editor or the two YAML settings above.

Legacy `co2_indicator_corner` configurations still supply omitted X/Y values, now at the
full card's corners. Explicit coordinates override their respective axes. The legacy
selector has been replaced by coordinate fields in the editor.

The example entity IDs are placeholders; choose your actual sensors. If `values` is omitted,
the selected `co2_entity` appears below the clock. An explicit list replaces that default
entirely, while `values: []` hides the section. The visual editor supports adding, removing,
and moving readings up/down; **Use CO₂ default** removes the explicit list again. Changing
readings does not change the indicator's `co2_entity`.

Each entry requires a numerical `sensor.*` entity and may have a text `label`. Labels default
to Home Assistant's sensor names; units and numbers use its formatting and display precision.
Negative values such as below-zero temperatures are valid. Missing, invalid, unavailable,
or disconnected readings keep their labels and show “—”, without affecting other readings.
Sensors that still exist remain tappable while unavailable; missing entities are disabled.
Labels wrap to two lines, and unusually long values are truncated visually with the full
value retained in the reading's accessible label and tooltip.

Tap anywhere on a reading to open its native Home Assistant entity details, with history
where available. Readings also support Tab and Enter/Space. Recorded history depends on
Home Assistant's [History and Recorder configuration](https://www.home-assistant.io/integrations/history/).

## Display behavior

- The default view puts the clock in the left two thirds and shows up to five events over
  the next seven days on the right. The agenda, countdown, and ongoing-event blocks align
  near the bottom with 24–48 px of responsive bottom padding. Current all-day entries are
  included and labeled “All day”.
- Sensor readings sit at the bottom left with larger numbers, smaller labels, and no card
  borders. They form a row on wide layouts and wrap into two rows on narrower layouts.
  The clock and date center in the remaining space above them, leaving a clear gap.
- A timed event starting strictly less than one hour away uses equal halves: clock left,
  title and countdown right. Remaining minutes round up; the final minute reads “in less
  than a minute”. At exactly one hour, the agenda remains visible.
- An ongoing event takes priority until its end. The earliest ongoing event wins; events
  with the same start share the title area. Each disappears at its own end. All-day events
  never take focus. Titles wrap to at most three lines, with an ellipsis for overflow.
- **Done** dismisses the displayed ongoing event (or all events sharing its title area)
  locally, returning to the agenda unless another ongoing event or approaching countdown
  takes focus. Dismissals survive calendar refreshes and temporary disconnections, expire at
  each event's scheduled end, and reset on a page reload or calendar change. Calendar events
  are not modified. An event whose title or scheduled times change can take focus again.
- The clock is 24-hour `HH:MM`, with weekday and date underneath. Labels are English and
  times use Home Assistant's timezone, including all-day event dates and DST transitions.
- A filled circle grows around its configured center across the full card (top-right by default).
  At a card corner, clipping leaves a quarter circle visible; moving inward reveals more of it. By default
  it is hidden below 600 ppm, muted yellow from **600 through 1000**, and muted red **above
  1000**. The panel and clock stay dark. The calendar has no numerical CO₂ footer; readings
  belong in the separate values section below the clock.
- The indicator's radius grows proportionally to CO₂, reaching its maximum at twice the
  configured critical threshold (2000 ppm by default), then stays capped. At 1000 ppm it has
  half its maximum radius. Maximum radius is `60% × indicator scale` of the panel's shorter
  dimension: scale `1` gives 60%, `0.5` gives 30%, and `1.5` gives 90%. It stays anchored to
  its configured percentage position when the card resizes. The radius retains its existing
  calendar-panel basis when the panel expands from the right third to the right half for focus events.
  Changes ease over one second; reduced-motion preferences apply updates immediately.
- An empty calendar says “No upcoming events”; a failed read says “Calendar unavailable”.
  Event details are removed after a failed read. Missing, unknown, non-numeric, negative or
  incompatible-unit CO2 readings hide the indicator. The selected reading in the values
  section independently shows a number or “—” according to its availability.
- On a Home Assistant disconnection, event details are removed and CO2 becomes unavailable.
  The clock continues. A calendar failure alone does not invalidate a working CO2 sensor.

Calendar range reads run every minute with a 15-second timeout. The clock and focus transitions
update locally every second. Calendar data older than 90 seconds is discarded, including on
wake after suspension. The external calendar provider's own synchronization interval also
applies. Event descriptions and locations are not displayed or logged; the card persists no
event data or credentials across page reloads. Touch controls are Done and the sensor readings;
no audio is added.

## Preview and development

Use **Node.js 22 or newer**. The preview and logic tests need no npm installation:

```sh
npm run preview
npm test
```

Open <http://127.0.0.1:8765/> for the interactive preview. It uses synthetic events and CO2
values, with scenario, time, scale, X/Y position sliders, and readings controls. Tapping a reading opens a
synthetic details dialog; real Home Assistant history is not loaded. The server binds
only to loopback and serves the two preview files and card module. Stop with Ctrl-C.
To choose another port: `npm run preview -- 8766`.

For the complete local checks:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Browser checks cover Done dismissals, keyboard activation and reset on reload,
refresh/timeout/reconnect behavior, offline/empty states, safe title rendering,
custom CO₂ settings, whole-card indicator coordinates and clipping, sensor reading defaults/formatting/tap/keyboard,
editor add/remove/reorder/reset, text contrast, transitions and reduced motion, and calendar-panel
geometry and one-to-four-reading layouts at 1280×800,
960×600 and 800×480. Screenshots are saved
under `/tmp/echo-show-dashboard`. Set `ECHO_SCREENSHOT_DIR` to change that directory, or
`ECHO_CHROMIUM_PATH` to use an existing Chromium executable. An external Playwright module
can be supplied with `ECHO_PLAYWRIGHT_MODULE`.

The `echo-show-card.js` file in the repository root is both source and installable artifact.
There is no build step. Playwright is a development dependency and is not installed into HA.
See [release instructions](docs/releasing.md) for packaging and GitHub metadata.

The APIs were checked against Home Assistant Core 2026.10.4, and the card was tested in local
Chromium with synthetic data. Real calendar permissions and on-device WebView rendering must
still be checked during installation.

## Troubleshooting and removal

- **Custom element does not exist:** check the resource URL returns JavaScript, its type is
  module, and reload the browser. Check that it is registered only once.
- **Calendar unavailable:** confirm the calendar exists, its integration is available, and
  the kiosk's logged-in user has read access. Provider synchronization can delay edits.
- **CO₂ unavailable:** select the actual sensor and verify a numerical value in ppm in HA.
- **Navigation still visible:** configure your existing kiosk's fullscreen/navigation controls.
  Panel view controls card layout; it does not hide Home Assistant chrome.
- **Updates look unchanged:** reload the kiosk after HACS updates. For manual installation,
  change the resource version query as well.

To revert the kiosk, restore its recorded previous start URL. Remove references to this card
from dashboards before uninstalling it or removing its resource. Keep your calendars, sensors
and integrations intact. A full Home Assistant restore is not needed to undo card installation.

## License

[MIT](LICENSE).
