---
inclusion: fileMatch
fileMatchPattern:
  - "src/analysis/**"
  - "tools/export_cloud_dive.py"
  - "tools/tune_params.py"
  - "static/cloud-dive/**"
---
# Science Guardrails

Rules for any code, test or text that produces or describes icing evidence. They apply when files under
`src/analysis/`, the Cloud Dive exporter and tuner, or `static/cloud-dive/` are in context.
Origin: `docs/Kiro_Research_Direction_Review.md` sections 3.2 and 3.3 (research branch),
amended on 2026-11-13 for the Cloud Dive game (amendments are marked **Amended**).

## What the system may claim

1. Never output or imply icing severity, intensity or probability about the atmosphere. No words such as
   light, moderate, severe, likely or unlikely. `icingRisk` stays `null` in new code.
   **Amended:** the Cloud Dive game may show a labelled integer *ice index* and dollar costs. They are game
   values computed by stated rules, not weather statements. Rules for game values:
   - label them "Game model" and "illustrative"; never present the index as severity, risk or a forecast;
   - never map index ranges to words such as light, moderate or severe;
   - never show the index in the dispatcher view or the API;
   - parameters (fuel price, anti-ice factor, speed loss, drag, ice rates) live in the case file and change
     only through `tools/tune_params.py`; log each change in `docs/kiro-usage-log.md`; never edit weather
     data to make a case balanced.
2. Never claim accuracy. Accuracy has not been evaluated. Agreement with other products (for example PIREPs
   or the GK-2A ICING product) may be reported only as "agreement", with sample count and conditions.
   PIREPs choose and label cases; they are reports, not validation.
3. Never state "no icing", "ice-free", "safe" or "clear of ice". Use "Not indicated".
4. Never suggest an altitude, route change or other operational action.
   **Amended:** in the game the player decides. The game shows no cost preview and no recommended choice.
   The reference results (Best, Straight-ahead, Wasteful extreme) appear only after the flight and are
   labelled game references, not procedures.
5. The system shows evidence, not advice. Every user-facing statement must be traceable to a source value.

## Evidence levels

The only four levels are:
- `Observed supercooled layer at planned altitude`
- `Possible (forecast only)` (rule `ifs-temperature-rh-v1`: temperature -25 to 0 C and relative humidity at least 85 percent)
- `Not indicated`
- `Not assessed`

Rules:
- `Not assessed` is for outside domain, quality-rejected, inconsistent, missing or otherwise unavailable
  evidence. It must never be converted to `Not indicated`, never be drawn as clear, and never be omitted
  from summaries.
- A forecast-only result must never be labelled as observed.
- Do not reduce a route to a single worst-case level or badge. Report kilometres and segments per level.

## Satellite limits

- A passive imager sees the top cloud layer only. A supercooled layer below a higher cloud is not visible.
  Code and text must not treat "no signal" as "no supercooled layer".
- CTPS and GOES phase flags are cloud-top evidence, not evidence about the whole cloud column.
- GOES phase code 2 (`super_cooled_liquid_water`) is the supercooled flag; code 3 (mixed) is not.
- GOES cloud-top height is geopotential height (standard name `geopotential_height_at_cloud_top`), used as
  height above sea level. Phase, optical depth and particle size are 2 km; cloud-top height is 10 km.
  Never claim detail finer than one satellite pixel. The corridor and lanes are illustrative, not airways.
- Cloud base is a statistical estimate (Noh et al. 2017), not an observation. Keep the estimation method in
  the output. A deep-convection or otherwise unknown base stays `null`; never invent one.
- Cloud base is not terrain-clamped unless the specification changes.

## Units and time

- All times are UTC and timezone-aware. No local time in code paths or stored data. KST appears only in
  conversation and in the submission checklist.
- Altitude in feet MSL. Distance in kilometres. Temperature in kelvin internally and degrees Celsius in
  displayed fields. Pressure in hPa. Fuel in kilograms; cost in US dollars (illustrative).
- Convert units at the boundary and name the unit in the field or variable (`topFt`, `distanceKm`, `ctt_k`,
  `cloudTopTemperatureC`, `fuelUsdPerKg`).

## Determinism and provenance

- Deterministic rules only. No language model, random number or network call in any assessment path or in
  the game engine and solver. The same input must give the same output (Python and JavaScript agree).
- Every output that carries an assessment must carry: data source, observation time (UTC), forecast run and
  receipt time when forecast data was used, method names for cloud base and isotherm heights, and the rule
  name and version.
- Change the rule version whenever a threshold, ordering or condition changes.
- Thresholds are described as uncalibrated screening values unless validated, and are echoed in the output.

## Missing data

- Missing values stay `null` and carry a state or reason code. Never fill a gap with a default that looks
  like a measurement.
- Never let NaN or infinity reach JSON.
- Keep the viewer contract: `distanceKm` starts at 0 and strictly increases; `baseFt` is never above `topFt`;
  no phase or supercooled value when `topFt` is `null`.

## Testing expectations

- Every rule row has a unit test. Rules about containment, ordering, determinism, conservation and "not
  assessed never becomes not indicated" have property-based tests (see
  `.kiro/specs/cloud-dive/design.md`, section 10).
- Tests that use synthetic data must label it synthetic in the test name.
