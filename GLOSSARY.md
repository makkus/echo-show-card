# Echo Show clock and agenda

A kiosk display combining a clock, calendar events, sensor values, and a CO₂ indicator.

## Language

**Calendar panel**:
The right-hand region showing either upcoming events or a countdown or ongoing event.

**Values section**:
A dedicated region beneath the clock containing an ordered collection of displayed readings.

**Displayed reading**:
A selected sensor's numerical value in the values section, identified by a label and accompanied by its unit when available.

**CO₂ level**:
One of normal, warning, or critical, determined by comparing an available CO₂ reading against two thresholds.
_Avoid_: Yellow level, red level

**CO₂ indicator**:
A filled circle whose color shows the CO₂ level and whose size increases continuously with the reading, up to a maximum. The card edges clip the circle when its center is near an edge or corner.
_Avoid_: CO₂ background, CO₂ corner indicator

**Indicator position**:
The center of the CO₂ indicator, measured across the full card from its top-left corner.

**Indicator scale**:
A size multiplier for the CO₂ indicator that does not change its CO₂ level or color.

**Indicator edge softness**:
The degree to which the CO₂ indicator's perimeter fades into the background while its center remains solid.
_Avoid_: Outline blur

**Unavailable CO₂ reading**:
A missing or unusable sensor reading, for which no CO₂ level can be determined.
_Avoid_: Normal reading
