---
inclusion: fileMatch
fileMatchPattern: "src/analysis/**"
---

# Science Guardrails

Rules for any code, test or text that produces or describes icing evidence. They apply when files under `src/analysis/` are in context. Source: `docs/Kiro_Research_Direction_Review.md`, sections 3.2 and 3.3.

## What the system may claim

1. Never output or imply icing severity, intensity or probability. No words such as light, moderate, severe, likely or unlikely. No numeric score. `icingRisk` stays `null`.
2. Never claim accuracy. Accuracy has not been evaluated. Agreement with other products (for example the GK-2A ICING L2 product or SIGWX/AIRMET) may be reported only as "agreement", with sample count and conditions.
3. Never state "no icing", "ice-free", "safe" or "clear of ice". Use "Not indicated".
4. Never suggest an altitude, route change or other operational action.
5. The system shows evidence, not advice. Every user-facing statement must be traceable to a source value.

## Evidence levels

The only four levels are:

- `Observed supercooled layer at planned altitude`
- `Possible (forecast only)`
- `Not indicated`
- `Not assessed`

Rules:

- `Not assessed` is for outside domain, quality-rejected, inconsistent, missing or otherwise unavailable evidence. It must never be converted to `Not indicated`, never be drawn as clear, and never be omitted from summaries.
- A forecast-only result must never be labelled as observed.
- Do not reduce a route to a single worst-case level or badge. Report kilometres and segments per level.

## Satellite limits

- A passive imager sees the top cloud layer only. A supercooled layer below a higher cloud is not visible. Code and text must not treat "no signal" as "no supercooled layer".
- CTPS phase and supercooled flags are cloud-top evidence. They are not evidence about the whole cloud column.
- Cloud base is a statistical estimate (Noh et al. 2017), not an observation. Uncertainty is larger at night. Keep the estimation method (`cloudBaseMethod`) in the output. A deep-convection or otherwise unknown base stays `null`; never invent one.
- Cloud base is not terrain-clamped unless the specification changes.

## Units and time

- All times are UTC and timezone-aware. No local time in code paths or stored data. KST appears only in conversation, never in data.
- Altitude in feet MSL. Distance in kilometres. Temperature in kelvin internally and degrees Celsius in displayed fields. Pressure in hPa.
- Convert units at the boundary and name the unit in the field or variable (`topFt`, `distanceKm`, `ctt_k`, `cloudTopTemperatureC`).

## Determinism and provenance

- Deterministic rules only. No language model, random number or network call in any assessment path.
- The same input must give the same output.
- Every output that carries an assessment must carry: data source, observation time (UTC), forecast initialization and receipt time when forecast data was used, method names for cloud base and isotherm heights, and the rule name and version.
- Change the rule version whenever a threshold, ordering or condition changes.
- Thresholds are described as uncalibrated screening values unless validated, and are echoed in the response.

## Missing data

- Missing values stay `null` and carry a state or reason code. Never fill a gap with a default that looks like a measurement.
- Never let NaN or infinity reach JSON.
- Keep the viewer contract: `distanceKm` starts at 0 and strictly increases; `baseFt` is never above `topFt`; no phase or supercooled value when `topFt` is `null`.

## Testing expectations

- Every rule row has a unit test. Rules about containment, ordering, determinism and "not assessed never becomes not indicated" have property-based tests (see `.kiro/specs/icing-layer-fusion/design.md`, section 10).
- Tests that use synthetic data must label it synthetic in the test name.
