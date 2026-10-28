# Changelog

## Unreleased

- Initial clock and seven-day agenda card with upcoming/ongoing event focus.
- Done button to dismiss ongoing events locally until their scheduled end without editing the calendar.
- Filled CO₂ corner indicator with continuous, capped radius growth, configurable
  thresholds/colors/scale, and a numerical reading at the calendar panel's bottom.
- Dark calendar background and backing behind overlapping text, one-second indicator
  transitions, reduced-motion support, and reset in the visual editor.
- Bottom-aligned calendar content with responsive padding and a separate values section
  beneath the clock for up to four ordered sensor readings. Readings use Home Assistant
  formatting, optional labels, unavailable placeholders, and tap/keyboard entity details.
- Configurable CO₂ circle center across the full card using X/Y percentages. Card edges
  reveal quarter, half, or full circles; clock/date/readings retain dark text backing.
  Legacy corner settings supply defaults for omitted coordinates.
- Visual calendar and sensor configuration, synthetic preview and browser checks.
- HACS packaging for the first planned release, `v0.1.0`.
