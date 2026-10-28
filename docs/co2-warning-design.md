# Calendar-panel CO₂ warnings

Status: implemented and verified locally in Chromium with synthetic data. The
circle indicator replaces the previous full-panel CO₂ background. Live Home
Assistant and on-device rendering have not been verified for this change.

## Agreed replacement design

- Replace the changing full-panel background with a filled circle centered at
  configurable X/Y coordinates across the full card (top-right by default).
  At a card corner the edges clip it to a quarter circle. Moving inward reveals
  more of the circle, including the full circle when its radius fits. The filled
  shape should make the CO₂ level recognizable from a distance.
- Coordinates are percentages of the full card's width and height, including
  the clock region. `0 / 0` is top-left, `50 / 50` is the center, and `100 / 100`
  is bottom-right. Values from 0 to 100, including fractions, are supported.
- Clip only at the card edges. The circle can cross the column divider and must
  remain circular on rectangular cards. Resize geometry when the card or calendar
  panel changes size, including transitions between agenda and focus layouts.
- Keep the calendar panel's background dark.
- Grow the indicator's radius continuously as CO₂ rises, up to a maximum size.
  The fraction of the maximum radius is the reading divided by twice the
  configured critical threshold, capped at 1. With the defaults, 500 ppm is 25%,
  1000 ppm is 50%, and 2000 ppm or higher is 100% of the maximum radius.
- The maximum radius is 60% of the calendar panel's shorter dimension multiplied
  by the indicator scale. The scale defaults to 1 and accepts values from 0.5 to
  5, inclusive. A scale of 5 gives a maximum radius of 300% of the shorter
  dimension. The same sizing rule applies in agenda, countdown, and ongoing modes.
- Keep the existing configurable level thresholds and colors; color changes remain
  discrete at the level boundaries.
- Hide the indicator for normal readings. The existing default normal color matches
  the dark panel background, and a visible normal indicator is unnecessary.
- Hide the indicator for unavailable readings. The values section represents
  unavailable readings with an em dash and retains their labels.
- Place the indicator behind the clock, calendar, and readings. Use dark backing
  behind overlapping text to preserve readability without rearranging content.
  The decorative circle does not intercept touch or keyboard controls.
- Show the numerical CO₂ reading by default in the separate values section below
  the clock. The calendar panel has no numerical CO₂ footer. An explicit readings
  list controls which sensor values appear; see [the layout design](dashboard-layout-design.md).
- Ease changes into place over about one second, without pulsing or flashing.
  When reduced motion is enabled, apply updates immediately.

### Replacement configuration

- Add an "Indicator scale" control to the visual editor and expose it in YAML as
  `co2_indicator_scale`. Omitted values use 1. Invalid values are rejected through
  the existing configuration validation.
- The scale changes only the indicator's maximum radius; it does not change the
  growth fraction, level thresholds, or colors.
- "Reset CO₂ settings" also restores the scale to 1 and preserves entity selections.
- `co2_indicator_x` and `co2_indicator_y` set the circle center in YAML or the
  editor, defaulting to `100 / 0`. Reset restores this position, preserving the
  explicit readings list. Position does not change growth or scale.
- Legacy `co2_indicator_corner` settings remain accepted and supply defaults for
  omitted coordinate axes, now at the full card's corners. An explicit coordinate
  overrides its corresponding axis. The editor exposes coordinate fields instead
  of the legacy corner selector.
- Keep existing threshold and color configuration keys compatible. Warning and
  critical colors now apply to the circle indicator, rather than the panel.
  Normal readings remain hidden, including with a customized normal color.

## Thresholds and independent failures

- Defaults remain normal below 600 ppm, warning from 600 through 1000 ppm,
  and critical strictly above 1000 ppm. Warning is muted yellow (`#e5c76b`);
  critical is muted red (`#af4d47`). Comparisons use the actual fractional reading.
- Thresholds must be finite, nonnegative numbers, with warning strictly below
  critical. Fractional thresholds are allowed. Colors accept six-digit hex values
  (`#RRGGBB`) through either color pickers or editable text fields.
- Missing, invalid, negative, incompatible-unit, and disconnected readings are
  unavailable, not normal. A calendar failure still leaves a working CO₂ indicator
  visible. A CO₂ failure does not hide available calendar events.

## Larger scale and edge softness extension

Status: implemented and verified locally in Chromium with synthetic data on
2026-10-28. Live Home Assistant and on-device rendering remain unverified.

Agreed behavior:

- Expand the indicator scale range to 0.5–5, inclusive, accepting fractional
  values. Keep the existing CO₂ growth rule and clipping at the card edges.
- Add adjustable indicator edge softness: fade only the perimeter into the
  background while keeping the center solid and text sharp.
- Keep the fade inside the circle's existing outer radius. Do not add an outward
  glow or enlarge the circle's footprint. Card edges continue clipping the shape.
- Use a 0–100 softness control. Zero preserves the crisp edge; 100 fades across
  the outer half of the radius and leaves the inner half solid. Intermediate
  values increase the fade width proportionally. The fade width scales with the
  current radius as the CO₂ reading, scale, or layout changes.
- Preserve the existing appearance for omitted settings: indicator scale 1 and
  a crisp edge (zero softness).

### Configuration and behavior

- Expand `co2_indicator_scale` consistently in validation, the visual editor, and
  the interactive preview. Keep its default at 1.
- Expose edge softness as `co2_indicator_softness` in YAML, labeled "Indicator edge
  softness" in the editor and "Edge softness" in the preview. Accept finite numbers from 0 to 100,
  including fractions, and default to 0. Reject invalid values through the existing
  validation flow without replacing the last valid configuration.
- For current radius R and softness S, the fade width is R × S / 200. The fill
  remains fully opaque inside R minus the fade width, then fades to transparent
  at R. Zero softness uses the existing solid fill.
- "Reset CO₂ settings" restores scale 1 and softness 0 while preserving entity
  selections and the explicit readings list, as it does today.
- Softness affects only the circle's edge opacity. Preserve its center position,
  growth rule, level thresholds, colors, normal/unavailable hiding, text backing,
  click-through behavior, and existing motion/reduced-motion behavior.
- The README configuration table, example, and preview instructions document both
  controls. The glossary defines indicator edge softness.

### Extension verification

- Logic and editor checks cover defaults, inclusive bounds, fractional values,
  invalid values, configuration round trips, and reset behavior for both controls.
- Browser screenshots are decoded and sampled at several distances from the
  circle center to verify actual opacity for softness 0, 50, and 100. These checks
  cover corner and center positions, agenda and ongoing layouts, different scales
  and readings, and 1280×800, 960×600, and 800×480 viewports.
- Geometry checks cover scales through 5, including fractional scales above 1.5,
  saturation, and hidden states. The existing resize check runs with softness 100.
- Text contrast, Done, and sensor taps remain checked with a white indicator at
  scale 5 and softness 100. Growth, opacity, color transitions, and reduced motion
  are checked with softness enabled.
- Center and corner soft-edge screenshots and the large white-indicator view were
  visually inspected. Screenshots are under `/tmp/echo-show-dashboard`.

## Verification

- `npm test`: all 27 logic tests passed, including growth fractions, saturation,
  custom thresholds, scale/coordinate validation, legacy defaults, readings, and calendar logic.
- `npm run check`: syntax and HACS packaging checks passed.
- `npm run test:browser`: Chromium checks passed for editor validation/reset,
  configuration round trips (including legacy normal color), dark base background,
  safe title rendering, and preserving calendar data during presentation edits.
- Layout checks cover agenda, countdown, ongoing, long-title, empty, calendar-error,
  and offline states at 1280×800, 960×600, and 800×480. Radius, scale bounds,
  saturation, hiding, circular geometry, full-card corner/edge/center/fractional
  positions, and quarter/half/full visibility were checked across these sizes.
  Geometry also updates on a container resize without a new HA state. The numerical
  reading is in the values section below the clock.
- Text backing retains at least 4.5:1 contrast even over a custom white indicator.
  Done remains usable with the largest indicator. Existing dismissal, refresh,
  reconnect, timeout, and keyboard behavior checks also passed.
- A real-time browser check verified intermediate motion and completion of the
  one-second transition, plus immediate growth and hiding with reduced motion.
- Screenshots of agenda, ongoing, long-title, maximum-size, white-indicator, and
  editor states were generated under `/tmp/echo-show-dashboard`. Representative
  normal and maximum-size views were visually inspected.
- The interactive preview includes CO₂ values through 3000 ppm, scale and edge
  softness sliders, X/Y coordinate sliders, and sensor-readings controls. Coordinate screenshots,
  including a white circle behind the clock and values, were visually inspected.

This is a reversible display and configuration change; a separate architecture
decision record is unnecessary.
