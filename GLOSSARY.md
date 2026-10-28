# Echo Show clock and agenda

A kiosk display combining a clock, calendar events, and a CO₂ indicator.

## Language

**Calendar panel**:
The right-hand region showing either upcoming events or a countdown or ongoing event, with the CO₂ reading at its bottom.

**CO₂ level**:
One of normal, warning, or critical, determined by comparing an available CO₂ reading against two thresholds.
_Avoid_: Yellow level, red level

**CO₂ corner indicator**:
A filled quarter circle at the calendar panel's top-right corner whose color shows the CO₂ level and whose size increases continuously with the reading, up to a maximum.
_Avoid_: CO₂ background

**Indicator scale**:
A size multiplier for the CO₂ corner indicator that does not change its CO₂ level or color.

**Unavailable CO₂ reading**:
A missing or unusable sensor reading, for which no CO₂ level can be determined.
_Avoid_: Normal reading
