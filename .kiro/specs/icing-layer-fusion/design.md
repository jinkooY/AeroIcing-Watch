# Design — Icing Layer Fusion

Draft for Kiro to refine. Implements `requirements.md` in this folder. No code is prescribed here; names are proposals. Existing modules referenced below are in the repository at the time of writing: `src/analysis/icing_profile.py` (`build_profile`, `_sample`), `src/analysis/cloud_base.py` (`estimate_base`), `src/analysis/route_sampler.py` (`sample_route`), `src/analysis/route_weather.py` (`atmosphere`, `environment`, `RULE`), `src/integration/ifs_grid.py` (`choose_bundle`, `sample`), `src/api/icing.py` (`cross_section`), `tools/collect_ifs.py` (`LEVELS`).

## 1. Data flow

```
GET /api/icing/cross-section (existing params + optional flight-profile params)
  -> sample_route()                       distance, lat, lon per sample      [existing]
  -> flight profile                       plannedAltFt, etaUtc per sample    [new]
  -> read_frame() CTPS (+ optics)         satellite fields                   [existing]
  -> build_profile() per-sample cloud     top, base, phase, supercooled,     [existing]
                                          retrievalState
  -> choose_bundle() IFS                  bundle received <= decision time   [existing]
  -> isotherm heights                     zeroCFt, minus20CFt, method        [new]
  -> candidate layer                      [lowerFt, upperFt] or null         [new]
  -> forecast criterion at planned alt    met / not_met / unassessed         [new]
  -> evidence level                       one of four labels + reason        [new]
  -> route summary                        km and segments per level          [new]
  -> response (existing fields + new fields)
```

Decision time for choosing the IFS bundle: the request time, or the frame observation time when `at` is given. Which of the two is used is TBD; the replay spec needs the second.

## 2. Modules

| Module (proposed) | Responsibility |
| --- | --- |
| `src/analysis/flight_profile.py` | Build the climb–cruise–descent profile from inputs and return per-sample planned altitude and ETA. Pure function of distances and parameters. |
| `src/analysis/isotherms.py` | Find 0 °C and −20 °C heights from an IFS column or from cloud-top temperature plus lapse rate. Returns height and method. |
| `src/analysis/icing_layer.py` | Candidate layer, forecast criterion, evidence level, per-sample reason codes. Pure function of one sample's inputs. |
| `src/analysis/route_summary.py` | Interval assignment, segment merging, km per level. |
| `src/analysis/icing_profile.py` (existing) | Orchestrates; keeps the current per-sample cloud fields and adds the new fields. |
| `src/api/icing.py` (existing) | Adds optional query parameters and passes the IFS bundle. |
| `tools/collect_ifs.py` (existing) | `LEVELS` gains 925 and 700. |

Pure functions take plain numbers and return plain values so they can be property-tested without files.

## 3. Flight profile

Inputs: departure elevation `dep_elev_ft`, arrival elevation `arr_elev_ft`, cruise altitude `alt_ft`, `climb_fpm`, `descent_fpm`, `tas_kt` used as constant ground speed, `departure_at` (UTC).

Geometry at constant ground speed `v` (km/min):

- climb distance `Dc = (alt_ft - dep_elev_ft) / climb_fpm * v`
- descent distance `Dd = (alt_ft - arr_elev_ft) / descent_fpm * v`
- If `Dc + Dd <= L` (route length): trapezoid; altitude is linear from `dep_elev_ft` to `alt_ft` over `[0, Dc]`, constant to `L - Dd`, linear down to `arr_elev_ft` at `L`.
- Else triangle: the peak is where the climb line meets the descent line; `profileShape = "triangle"`, `peakAltFt` reported.

ETA of a sample at distance `d` is `departure_at + d / v`. Default `profile` is `level`, where every sample has `plannedAltFt = alt_ft` (keeps existing callers' meaning).

Response object `flightProfile`: `shape`, inputs echoed with units, `cruiseAltFt` (equals `flightAlt_ft`), `peakAltFt`, `departureAt`, `defaultsUsed` list naming parameters that took a default.

Default values for rates and speed: TBD.

## 4. Isotherm heights

From IFS: for the sample location and frame observation time, call `ifs_grid.sample()` once per pressure level in `bundle[0]["pressure_levels_hpa"]` to get `t` (K) and `gh` (gpm). Order levels from highest pressure (lowest height) upward. Find the lowest level pair where temperature crosses 273.15 K (and separately 253.15 K) and interpolate height linearly in temperature between the pair. `height_ft = gh * 3.28084`. If the lowest level is already colder than the isotherm, or the highest level is warmer, the isotherm is outside the vertical range and the method falls back (requirement 2.5). Inversions are not resolved: the lowest crossing is used (limitation, to be listed).

Fallback from cloud-top temperature: `height_km(T_iso) = top_km - (T_iso - CTT) / 6.5`, valid only when `CTT < T_iso`; otherwise `unavailable`. Method string recorded as `ctt_standard_lapse`.

Geopotential height is treated as height MSL; the difference is ignored and listed as a limitation (TBD whether acceptable).

IFS pressure levels are added at collection time: `LEVELS = (925, 850, 700, 500, 300, 250)`. The expected message count check in `select()` uses `len(FIELDS) * len(LEVELS)` and needs no other change. `ifs_grid.load_bundle` already builds its pressure axis from bundle metadata, so four-level and six-level bundles both load. Old bundles stay valid (requirement 2.8).

## 5. Candidate layer and evidence level

Per sample, in order:

1. Retrieval state gate. States `outside_domain`, `quality_rejected`, `inconsistent_retrieval`, `no_retrieval` or no planned altitude give `Not assessed`. State `clear` gives `Not indicated`.
2. Satellite supercooled signal `S`: `supercooled is True`, or (`phase == "liquid"` and `cloudTopTemperatureC < 0`). `supercooled is None` with phase `liquid` and CTT < 0 still counts as a signal; this follows the review text "or liquid and CTT below 0 °C".
3. If `S`, compute the layer `[max(base, zeroC), min(top, minus20C)]` when base, zeroC and minus20C are known.
4. Compare planned altitude with the layer.
5. If not decided by step 4, evaluate the forecast criterion.

Decision table. Rows are checked top to bottom.

| # | Condition | Evidence level | Reason code |
| --- | --- | --- | --- |
| 1 | retrievalState in {outside_domain, quality_rejected, inconsistent_retrieval, no_retrieval} or plannedAlt null | Not assessed | the state, or `no_planned_altitude` |
| 2 | retrievalState == clear | Not indicated | `satellite_clear` |
| 3 | S, layer present, plannedAlt in [lower, upper] | Observed supercooled layer at planned altitude | `inside_candidate_layer` |
| 4 | S, layer present, plannedAlt > upper or < zeroC | Not indicated | `altitude_outside_candidate_layer` |
| 5 | S, layer null with reason `cloud_colder_than_minus20` | Not indicated | `cloud_colder_than_minus20` |
| 6 | S, layer null with reason `temperature_sources_inconsistent` | Not assessed | `temperature_sources_inconsistent` |
| 7 | not S, or S with base unknown, or S and zeroC <= plannedAlt < lower: forecast criterion met | Possible (forecast only) | `forecast_criterion_met` |
| 8 | same as 7, criterion not met, base known | Not indicated | `forecast_criterion_not_met` |
| 9 | same as 7, criterion unassessed, or base unknown and criterion not met | Not assessed | `forecast_unavailable` or `cloud_base_unknown` |

Rows 5 to 9 beyond the review's table are the author's reading and need developer confirmation (requirements 4.5, open decision 3).

The forecast criterion converts planned altitude to pressure with `route_weather.atmosphere()`, samples IFS at that pressure, location and frame time, and applies the thresholds in requirement 4.6. The existing `route_weather.environment()` returns `possible_environment`, `criterion_not_met` or `unassessed`; the new code may reuse it if the temperature bounds are aligned, otherwise a parameterised copy is needed (TBD).

## 6. Route summary

For samples `i = 0..n-1` with distances `d[i]`, interval start `s[i] = 0` for `i = 0` else `(d[i-1] + d[i]) / 2`; interval end `e[i] = d[n-1]` for `i = n-1` else `(d[i] + d[i+1]) / 2`. Sum of `e[i] - s[i]` over all samples equals `d[n-1]`. Adjacent samples with the same level merge into a segment. Output `routeSummary.levels` always contains all four keys, with `km: 0` and `segments: []` for absent levels, so "Not assessed" is never silently omitted.

## 7. Response shape (additive)

Existing fields are unchanged. Illustrative excerpt, values not real:

```json
{
  "ruleName": "TBD",
  "ruleVersion": "TBD",
  "flightProfile": {"shape": "trapezoid", "cruiseAltFt": 25000, "...": "..."},
  "forecast": {"initializedAt": "...", "validTime": "...", "receivedAt": "...", "levelsHpa": [925, 850, 700, 500, 300, 250]},
  "thresholds": {"forecastTemperatureC": ["TBD", 0], "forecastRhPercentMin": "TBD", "layerMinusTwentyC": -20, "lapseRateKPerKm": 6.5},
  "limitations": ["Satellite observes the top cloud layer only.", "Cloud base is a statistical estimate (Noh et al. 2017); night uncertainty is larger.", "Cloud base is not clamped to terrain."],
  "routeSummary": {"levels": {"Not assessed": {"km": 0, "segments": []}}},
  "samples": [
    {"distanceKm": 0, "topFt": null, "baseFt": null, "phase": null, "supercooled": null,
     "plannedAltFt": 0, "etaUtc": "...", "evidenceLevel": "Not assessed", "evidenceReason": "no_retrieval"}
  ]
}
```

The existing `samples[]` fields (`latitude`, `longitude`, `retrievalState`, `cloudBaseMethod`, `cloudBaseState`, `ctpsQualityFlag`, `cloudTopTemperatureC`, `icingExposure`) stay. Per-sample new field names: see requirement 6.7.

## 8. Viewer compatibility

`static/viewer.js` `validProfile()` ignores unknown fields, so additive fields do not break it. Rules the response must satisfy: see requirement 6.4. The fixed sampler gives 10 to 200 samples, within the viewer's 2 to 2000. The old design example with one sample would fail the two-sample minimum and is not to be reused.

Rendering of the candidate layer, isotherm lines and flight profile is handled in the `replay-and-ui` spec; this spec only supplies data.

## 9. Error handling

- Invalid profile parameters: HTTP 422 naming the field.
- IFS missing or unreadable: not an error; isotherm method falls back, forecast criterion is `unassessed`, and the sample may become `Not assessed`.
- Cache missing, corrupt or stale: existing labelled simulated fallback, with all samples `Not assessed` and reason `simulated_profile`.
- Isotherm or lapse arithmetic producing a non-finite number: treat as `unavailable`, never propagate NaN into JSON.

## 10. Correctness properties

Properties for property-based testing (Hypothesis is the suggested library; confirm with `tech.md`). Each should be written as a test with generated inputs, and each should be run on the pure functions first.

P1. Layer containment. For any sample where `candidateLayer` is non-null: `baseFt <= lowerFt <= upperFt <= topFt`, `lowerFt >= zeroCFt`, `upperFt <= minus20CFt`.

P2. Layer emptiness is explicit. For any inputs where `max(base, zeroC) > min(top, minus20C)`, the result has `candidateLayer == null` and a `candidateLayerReason`; it is never a layer with lower > upper.

P3. Not assessed never becomes Not indicated. For any sample with `retrievalState` in {outside_domain, quality_rejected, inconsistent_retrieval, no_retrieval}, `evidenceLevel == "Not assessed"`; and for any input, changing only a missing (null) value to another missing value never changes the level to `Not indicated`.

P4. Monotone evidence. Making IFS data unavailable (replacing it with null) never turns `Not assessed` into any other level, and never turns `Observed supercooled layer at planned altitude` into `Not indicated` unless the isotherm method changes.

P5. Observed requires satellite evidence. `evidenceLevel == "Observed supercooled layer at planned altitude"` implies `retrievalState == "observed"`, a satellite supercooled signal, and `plannedAltFt` within the candidate layer.

P6. Distances. Sample distances start at exactly 0 and strictly increase, for any route endpoints and any `spacing_km` in 5 to 100, for the profile and for the summary intervals.

P7. Summary conservation. Sum of `routeSummary.levels[*].km` equals the last sample distance within 0.001 km; every sample belongs to exactly one segment; all four level keys are present.

P8. Flight profile bounds. For any valid inputs, `min(dep_elev_ft, arr_elev_ft) <= plannedAltFt <= cruiseAltFt` (or `peakAltFt` for triangle), the first sample altitude equals departure elevation and the last equals arrival elevation (within rounding), and the profile has no step larger than the slope bound allowed by sample spacing.

P9. ETA. `etaUtc` is non-decreasing along the route, and the first equals `departure_at`.

P10. Viewer validity. For any generated route, profile parameters and frame content (including all-null cloud fields and fully clear frames), the response passes the `validProfile()` rules listed in requirement 6.4. Implement by porting the rules to a Python checker kept in sync with `static/viewer.js`, plus a Node-run check on saved responses.

P11. Determinism. Calling the build function twice with identical inputs gives equal output.

P12. No severity output. No response contains a non-null `icingRisk`, and no field name or value implies severity or probability.

P13. Isotherm ordering. When both isotherm heights are known by the same method, `minus20CFt >= zeroCFt`.

P14. Method recorded. Whenever `zeroCFt` or `minus20CFt` is non-null, `isothermMethod` is not `unavailable`; when `isothermMethod == "unavailable"`, both are null.

P15. Backward compatibility. For a request with only the five original required parameters, all fields of the previous response still exist with unchanged types.

## 11. Testing plan

Unit tests on pure functions with fixed examples for each row of the decision table in section 5; property tests P1 to P15; integration tests of the endpoint with a synthetic frame cache and a synthetic IFS bundle (pattern already used in `tests/test_icing_api.py` and `tests/test_ifs_route.py`); a check that the real archived frame `202609011324` still yields a valid response. The completion check from the review (a winter case shows an "Observed" sample in the descent, and the same route at cruise altitude only does not) is verified with real data once a winter frame is collected; until then it is verified with a clearly labelled synthetic fixture. Winter-case frame: TBD.
