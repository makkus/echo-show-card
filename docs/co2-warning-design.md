# Calendar-panel CO₂ warnings

Status: implemented and verified locally in Chromium with synthetic data. The
corner indicator replaces the previous full-panel CO₂ background. Live Home
Assistant and on-device rendering have not been verified for this change.

## Agreed replacement design

- Replace the changing full-panel background with a filled quarter circle anchored
  at the calendar panel's top-right corner, growing inward. The filled shape should
  make the CO₂ level recognizable from a distance.
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
- Hide the indicator for unavailable readings and retain the "CO₂ unavailable"
  label, so unavailable readings remain distinguishable from normal readings.
- Place the indicator behind calendar content and keep the corner strongly
  colored. Use subtle dark backing behind overlapping calendar text to preserve
  readability without rearranging the calendar. Judge the precise visual treatment
  and starting size in the local preview.
- Keep the numerical CO₂ reading at the panel's bottom.
- Ease changes into place over about one second, without pulsing or flashing.
  When reduced motion is enabled, apply updates immediately.

### Replacement configuration

- Add an "Indicator scale" control to the visual editor and expose it in YAML as
  `co2_indicator_scale`. Omitted values use 1. Invalid values are rejected through
  the existing configuration validation.
- The scale changes only the indicator's maximum radius; it does not change the
  growth fraction, level thresholds, or colors.
- "Reset CO₂ settings" also restores the scale to 1 and preserves entity selections.
- Keep existing threshold and color configuration keys compatible. Warning and
  critical colors now apply to the corner indicator, rather than the panel.
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

- `npm test`: all 20 logic tests passed, including growth fractions, saturation,
  custom thresholds, scale bounds/defaults, unavailable readings, and calendar logic.
- `npm run check`: syntax and HACS packaging checks passed.
- `npm run test:browser`: Chromium checks passed for editor validation/reset,
  configuration round trips (including legacy normal color), dark panel and clock,
  safe title rendering, and preserving calendar data during presentation edits.
- Layout checks cover agenda, countdown, ongoing, long-title, empty, calendar-error,
  and offline states at 1280×800, 960×600, and 800×480. Radius, scale bounds,
  saturation, hiding, circular geometry, and top-right anchoring were checked
  across these sizes. The numerical reading stays at the panel's bottom.
- Text backing retains at least 4.5:1 contrast even over a custom white indicator.
  Done remains usable with the largest indicator. Existing dismissal, refresh,
  reconnect, timeout, and keyboard behavior checks also passed.
- A real-time browser check verified intermediate motion and completion of the
  one-second transition, plus immediate growth and hiding with reduced motion.
- Screenshots of agenda, ongoing, long-title, maximum-size, white-indicator, and
  editor states were generated under `/tmp/echo-show-dashboard`. Representative
  normal and maximum-size views were visually inspected.
- The interactive preview includes CO₂ values through 3000 ppm and a scale slider.

This is a reversible display and configuration change; a separate architecture
decision record is unnecessary.
