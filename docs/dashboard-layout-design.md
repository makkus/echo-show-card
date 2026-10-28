# Dashboard layout and sensor values

Status: implemented and verified locally in Chromium with synthetic data. Actual
Home Assistant dialog rendering, available history, and on-device rendering have
not been verified for this change.

## Agreed layout

- Remove the numerical CO₂ reading and its footer from the calendar panel.
- Bottom-align the agenda, countdown, and ongoing-event blocks, including the
  Done button. Keep text left-aligned and agenda events in chronological order.
- Use responsive bottom padding of roughly 24–48 px so the calendar does not feel
  cramped on smaller screens.
- Build the values section in this change. Put it beneath the clock near the
  bottom left, with CO₂, room temperature, and additional selected sensors.
- Keep the values section within the left region so it does not reduce calendar
  height. It remains beneath the clock in both agenda and focus layouts.
- Add a configuration option for all four calendar-panel corners, defaulting to
  top-right. A left-hand corner is beside the column divider, not the screen's
  left edge.
- Check readability where bottom-corner indicators overlap the bottom-aligned
  calendar, including Done.

## Agreed values section

- Configure an ordered list of numerical sensor readings, with an optional custom
  label for each. Support selecting sensors, editing labels, and reordering entries
  in both the visual editor and YAML.
- Support up to four readings. Use larger numbers with units and smaller labels,
  without individual card borders. Arrange them horizontally where space allows
  and wrap into two rows on narrower layouts.
- If a reading is unavailable, keep its label and position and display an em dash
  instead of a value. Other readings remain visible; do not show stale data as current.
- Center the clock and date in the remaining space above the values section,
  allowing a slight upward shift when the values require two rows. Keep a clear
  gap between the date and readings.
- Tapping anywhere on a reading opens that sensor's native Home Assistant entity
  details dialog, with history where available. A temporarily unavailable sensor
  remains clickable so its details and history can still be inspected. A missing
  entity is disabled because there is no current entity to inspect.
- Use real buttons styled without card borders, with comfortable touch areas,
  visible keyboard focus, and Enter/Space activation.
- Default labels to Home Assistant's sensor names, with optional custom labels.
  Use Home Assistant's units and number formatting, respecting its display
  precision. The CO₂ indicator still compares the actual unrounded sensor reading
  against its thresholds.
- Long labels wrap to two lines. Unusually long values are visually truncated;
  their full formatted text remains in the accessible label and tooltip.

## Configuration and defaults

- Expose the readings list as `values` in YAML and provide add, remove, label,
  and reorder controls in the visual editor. Each entry selects a `sensor.*`
  entity and may provide a custom label. Reject more than four entries through
  configuration validation rather than silently dropping readings.
- If `values` is omitted, show the selected `co2_entity` as the default reading.
  If no CO₂ sensor is selected, there are no default readings.
- An explicit `values` list replaces the default entirely. An empty list hides
  the values section. Selecting a temperature sensor is an explicit configuration
  step; do not guess which temperature entity represents this room.
- Keep `co2_entity` independent of the explicit readings list. Adding or removing
  a displayed CO₂ reading does not change the sensor driving the corner indicator.
- Expose the corner as `co2_indicator_corner`, with `top-right` as the default and
  `top-left`, `bottom-left`, and `bottom-right` as the other choices. Include the
  selector in the visual editor and validate YAML values.
- Resetting CO₂ settings restores the default corner alongside the existing
  threshold, color, and scale defaults, preserving entity selections and the
  explicit readings list.

## Verification

- `npm test`: all 24 logic tests passed. Coverage includes defaults, explicit empty
  lists, ordering, label overrides, list-size and corner validation, HA formatter
  output, negative temperatures, and missing/invalid/unavailable/disconnected readings.
- `npm run check`: syntax and HACS packaging checks passed.
- `npm run test:browser`: editor add/remove/reorder, invalid drafts, configuration
  round trips, corner selection, CO₂ reset preserving explicit readings, and
  returning to the CO₂ default all passed. Controls fit a 400-pixel-wide editor.
- Pointer, Enter, and Space activation emitted the expected bubbling, composed
  `hass-more-info` request for the correct entity. Temporarily unavailable readings
  remain clickable, missing entities are disabled, and live updates preserve
  button identity. Labels are rendered as text, including markup-like values.
- One through four readings, two-row wrapping, long labels, and an explicitly hidden
  values section were checked at 1280×800, 960×600, and 800×480. The clock retains
  a clear gap above readings, which stay inside the left region with touch targets
  of at least 48 px. Calendar layouts retain 24–48 px of bottom padding.
- All four corners were checked at maximum size. Done was actually clicked with
  each corner at each viewport size. Existing radius, geometry, color, threshold,
  scale, refresh, dismissal, timeout, reconnect, motion, and reduced-motion checks
  passed. Text retains at least 4.5:1 contrast over a white indicator at bottom-right.
- Representative four-reading, long-label, bottom-corner, and editor screenshots
  were visually inspected. Screenshots are under `/tmp/echo-show-dashboard`.
- The local preview includes values and corner controls plus a clearly identified
  synthetic details dialog. Tests verify event emission; actual native dialog
  rendering and history in Home Assistant remain separate checks.

## Verified Home Assistant capabilities

- Home Assistant supports opening an entity's native more-info dialog. For sensor
  entities this includes a history graph when history is available. See the
  [more-info design](https://contributors.home-assistant.io/design/more-info/) and
  [dashboard actions](https://www.home-assistant.io/dashboards/actions/).
- The built-in action handler emits a bubbling, composed `hass-more-info` event
  with `{ entityId }`. This supports opening details from inside this card's shadow
  root without leaving the dashboard. See the
  [frontend action handler](https://github.com/home-assistant/frontend/blob/dev/src/panels/lovelace/common/handle-action.ts).
- History depends on Recorder data; an entity excluded from Recorder has no history.
  See the [History documentation](https://www.home-assistant.io/integrations/history/).
- Home Assistant provides entity name and state formatters, including a parts
  formatter that separates values and units for presentation. See the
  [hass formatter reference](https://contributors.home-assistant.io/frontend/reference/hass-object/#formatters).

The existing CO₂ growth, colors, thresholds, scale, and motion behavior are described
in [the CO₂ design](co2-warning-design.md). They remain unchanged apart from choosing
the indicator's corner and moving numerical CO₂ display into the values section.

These are reversible layout and configuration changes; a separate architecture
decision record is unnecessary.
