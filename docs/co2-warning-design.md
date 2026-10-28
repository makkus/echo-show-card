# Calendar-panel CO₂ warnings

Status: implemented and verified locally with synthetic data. Live Home Assistant
and on-device rendering have not been verified for this change.

## Agreed behavior

- The CO₂ background fills the calendar panel edge to edge, including its top and
  bottom padding. The clock and date keep their existing dark background.
- The colored region follows the calendar panel: the right third in agenda mode,
  expanding to the right half for countdowns and ongoing events.
- The numerical CO₂ reading moves from the card's bottom left to the bottom of
  the calendar panel.
- Keep three CO₂ levels: normal, warning, and critical. The dashboard card's visual
  editor exposes two ppm thresholds and three background colors.
- Preserve the existing defaults: normal below 600 ppm, warning from 600 through
  1000 ppm, critical strictly above 1000 ppm. Default background colors are
  `#151c24`, `#e5c76b`, and `#af4d47`, respectively.

## Configuration and readability

- Each background color has a color picker and an editable six-digit hex value
  (`#RRGGBB`). Text automatically uses a light or dark foreground suited to that background;
  foreground colors do not need separate settings.
- Both thresholds must be finite, nonnegative numbers, and the warning threshold
  must be strictly below the critical threshold. Fractional thresholds are allowed.
- Normal applies below the warning threshold. Warning includes both thresholds.
  Critical applies strictly above the critical threshold. Comparisons use the
  actual reading, including fractional values.
- Invalid entries show an error and are not applied as valid configuration.
- A "Reset CO₂ settings" action restores both thresholds and all three background
  colors. Entity selections are preserved.
- Existing dashboard configurations without these new settings use the defaults.

## Unavailable readings and independent failures

- Missing, invalid, negative, incompatible-unit, and disconnected readings display
  "CO₂ unavailable" on the original dark background (`#151c24`), regardless of the
  customized normal color. Unavailable is not a CO₂ level.
- A calendar failure still leaves a working CO₂ indicator visible. A CO₂ failure
  does not hide otherwise available calendar events.

## Verification

- `npm test`: all 15 logic tests passed, covering default and custom threshold
  boundaries, fractional readings, invalid configurations, unavailable readings,
  and automatic text contrast.
- `npm run check`: syntax and HACS packaging checks passed.
- `npm run test:browser`: Chromium checks passed for color-picker and hex-value
  updates, configuration round trips, validation errors, reset behavior, and
  preserving calendar data during presentation edits.
- Browser checks verified that the clock stays dark and the calendar background
  fills its region in agenda, countdown, ongoing, empty, error, and offline states,
  with the CO₂ reading at the panel's bottom, at 1280×800, 960×600, and 800×480.
- Custom light and dark backgrounds and a 400-pixel-wide editor were checked.
  Agenda, ongoing-event, and editor screenshots were visually inspected.

This is a reversible display and configuration change; a separate architecture
decision record is unnecessary.
