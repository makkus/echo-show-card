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
  1.5, inclusive. A scale of 1.5 gives a maximum radius of 90% of the shorter
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

## Verification

- `npm test`: all 26 logic tests passed, including growth fractions, saturation,
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
- The interactive preview includes CO₂ values through 3000 ppm, a scale slider,
  X/Y coordinate sliders, and sensor-readings controls. Coordinate screenshots,
  including a white circle behind the clock and values, were visually inspected.

This is a reversible display and configuration change; a separate architecture
decision record is unnecessary.
