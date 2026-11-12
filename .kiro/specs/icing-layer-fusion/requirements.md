# Requirements — Icing Layer Fusion

Draft for Kiro to refine. Source: `docs/Kiro_Research_Direction_Review.md`, section 3.2 and WO-3. This spec is additive to `.kiro/specs/aeroicing-watch/` and does not replace it. Where this spec and the old FR-3 rule (HIGH / MODERATE / LOW / NONE) disagree, this spec wins and FR-3 is superseded by requirement 4.

Items marked **TBD** are decisions the developer has not made. Kiro should ask rather than pick a value silently.

## Overview

Today the backend returns per-sample cloud evidence from GK-2A CTPS (`topFt`, `baseFt`, `phase`, `supercooled`, `retrievalState`) and leaves `icingRisk: null` and `assessmentState: "not_assessed"`. ECMWF IFS temperature and humidity are evaluated separately in `src/analysis/route_weather.py` for a fixed flight level.

This feature combines the two into one icing candidate layer per route sample and compares it with the aircraft's planned altitude at that sample, using a simple climb–cruise–descent flight profile. The output is an evidence level per sample, not a severity and not a probability.

## Glossary

- **Sample**: one point of the route from `sample_route()`, with `distanceKm`, `latitude`, `longitude`.
- **Planned altitude**: aircraft altitude in feet MSL at a sample, from the flight profile.
- **Satellite supercooled signal**: CTPS `supercooled == true`, or `phase == "liquid"` and cloud-top temperature below 273.15 K.
- **Icing candidate layer**: altitude interval `[lowerFt, upperFt]` in which the system considers supercooled liquid possible for a sample with a satellite supercooled signal.
- **Forecast criterion**: IFS temperature and relative humidity at the planned altitude meet the screening thresholds (see requirement 4.6).
- **Evidence level**: one of the four labels in requirement 4.

## Requirements

### 1. Flight profile

**User story:** As a dispatcher of domestic or short-haul routes, I want the route evaluated along a climb, cruise and descent altitude profile, so that climb and descent exposure is not hidden by a single cruise altitude.

Acceptance criteria:

1.1 WHEN a cross-section request supplies a cruise altitude and `profile=trapezoid`, THE SYSTEM SHALL assign each sample a planned altitude in feet MSL that follows a climb from departure elevation, a level cruise, and a descent to arrival elevation.

1.2 WHEN the route is too short to reach cruise altitude at the given climb and descent rates, THE SYSTEM SHALL use a triangular profile with a lower peak altitude and SHALL report `profileShape: "triangle"` in the response.

1.3 WHEN a request supplies `profile=level` or supplies no profile parameter, THE SYSTEM SHALL use `alt_ft` as the planned altitude of every sample, so existing callers keep their current meaning of `alt_ft`.

1.4 THE SYSTEM SHALL assign each sample an `etaUtc` timestamp in UTC computed from the departure time and a constant ground speed. Wind SHALL NOT be applied in this version.

1.5 THE SYSTEM SHALL accept these inputs with the stated units: departure elevation (ft MSL), arrival elevation (ft MSL), cruise altitude (ft MSL), climb rate (ft/min), descent rate (ft/min), ground speed (kt), departure time (UTC). Default values for climb rate, descent rate and ground speed are **TBD**; the response SHALL echo the values actually used under `flightProfile`.

1.6 IF departure elevation, arrival elevation or any rate is not finite, negative where a positive value is required, or the cruise altitude is below either elevation, THEN THE SYSTEM SHALL reject the request with HTTP 422 and a message naming the field.

1.7 THE SYSTEM SHALL return planned altitudes that are never below the lower of the two airport elevations and never above the cruise altitude.

### 2. Isotherm heights

**User story:** As a dispatcher, I want the 0 °C and −20 °C heights at each sample, so that the candidate layer is bounded by temperature and not only by cloud geometry.

Acceptance criteria:

2.1 WHEN an IFS bundle is available that was received at or before the decision time and covers the sample location and the frame observation time, THE SYSTEM SHALL compute the heights of the 0 °C and −20 °C isotherms in feet MSL by interpolating geopotential height against temperature across the bundle's pressure levels.

2.2 WHEN no usable IFS data exists for a sample, AND the sample has a finite cloud-top temperature and cloud-top height, THE SYSTEM SHALL estimate both isotherm heights from the cloud-top temperature and a standard lapse rate of 6.5 K/km.

2.3 THE SYSTEM SHALL record, per sample, `isothermMethod` with one of the values `ifs_interpolated`, `ctt_standard_lapse` or `unavailable`.

2.4 WHEN the isotherm heights come from the cloud-top temperature fallback, THE SYSTEM SHALL mark them as estimated in the response so the viewer can label them "estimated".

2.5 IF the 0 °C or −20 °C isotherm lies outside the vertical range of the IFS levels in the bundle, THEN THE SYSTEM SHALL NOT extrapolate from IFS and SHALL fall back to the method in 2.2 for that isotherm, recording the method used.

2.6 THE SYSTEM SHALL sample IFS at the frame observation time, not at the sample ETA, and SHALL report the difference between ETA and observation time per sample as `etaOffsetMin`. (Decision to confirm: **TBD**.)

2.7 THE SYSTEM SHALL record the IFS initialization time, valid time used, bundle receipt time and the pressure levels used in the response `forecast` object.

2.8 Where the IFS bundle has only the four older pressure levels (850, 500, 300, 250 hPa), THE SYSTEM SHALL still compute isotherm heights and SHALL record the levels used, so coarse interpolation is visible.

### 3. Icing candidate layer

**User story:** As a dispatcher, I want to see the altitude range where supercooled liquid is possible below the observed cloud top, so that I can compare it with my planned altitudes.

Acceptance criteria:

3.1 WHEN a sample has `retrievalState == "observed"`, a satellite supercooled signal, a known estimated cloud base and known isotherm heights, THE SYSTEM SHALL compute `lowerFt = max(baseFt, zeroCFt)` and `upperFt = min(topFt, minus20CFt)`.

3.2 WHEN `lowerFt > upperFt`, THE SYSTEM SHALL report `candidateLayer: null` and a `candidateLayerReason`: `cloud_colder_than_minus20` when `baseFt > minus20CFt`, or `temperature_sources_inconsistent` when `topFt < zeroCFt`.

3.3 THE SYSTEM SHALL return `candidateLayer` as `{lowerFt, upperFt}` or `null`, and `candidateLayerBasis` naming the isotherm method and the cloud-base method (`cloudBaseMethod` already in the profile).

3.4 WHEN the sample has a satellite supercooled signal but `baseFt` is null, THE SYSTEM SHALL report `candidateLayer: null` with `candidateLayerReason: "cloud_base_unknown"` and SHALL NOT invent a base.

3.5 THE SYSTEM SHALL NOT clamp the cloud base to terrain in this version and SHALL state this in the response `limitations` list. (Whether to add terrain is **TBD**.)

3.6 THE SYSTEM SHALL state in the response `limitations` list that the satellite observes the top cloud layer only and that the cloud base is a statistical estimate (Noh et al. 2017) with larger uncertainty at night.

### 4. Evidence levels

**User story:** As a dispatcher, I want each sample labelled with how strong the evidence is, so that I do not read a forecast screen as an observation or a missing value as clear.

The four evidence levels are exactly these strings:

- `Observed supercooled layer at planned altitude`
- `Possible (forecast only)`
- `Not indicated`
- `Not assessed`

Acceptance criteria (evaluate in this order; the first matching rule applies):

4.1 WHEN a sample's `retrievalState` is `outside_domain`, `quality_rejected`, `inconsistent_retrieval` or `no_retrieval`, OR its planned altitude is null, THE SYSTEM SHALL set `evidenceLevel` to `Not assessed` and `evidenceReason` to the retrieval state or `no_planned_altitude`.

4.2 WHEN a sample's `retrievalState` is `clear`, THE SYSTEM SHALL set `evidenceLevel` to `Not indicated` and `evidenceReason` to `satellite_clear`.

4.3 WHEN a sample is `observed`, has a satellite supercooled signal, has a non-null `candidateLayer`, and its planned altitude lies within `[lowerFt, upperFt]` inclusive, THE SYSTEM SHALL set `evidenceLevel` to `Observed supercooled layer at planned altitude`.

4.4 WHEN a sample is `observed`, has a satellite supercooled signal, has a non-null `candidateLayer`, and its planned altitude is above `upperFt` or below `zeroCFt`, THE SYSTEM SHALL set `evidenceLevel` to `Not indicated` with `evidenceReason: "altitude_outside_candidate_layer"`.

4.5 WHEN a sample is `observed` AND any of the following holds: it has no satellite supercooled signal; `candidateLayer` is null because of `cloud_base_unknown`; its planned altitude is below `lowerFt` but at or above `zeroCFt` (below the estimated cloud base, where a lower layer would be hidden from the satellite), THEN THE SYSTEM SHALL evaluate the forecast criterion at the planned altitude. IF the criterion is met, THE SYSTEM SHALL set `evidenceLevel` to `Possible (forecast only)`. IF it is not met AND the case is not `cloud_base_unknown`, THE SYSTEM SHALL set `Not indicated`. IF it is unavailable, or the case is `cloud_base_unknown` and the criterion is not met, THE SYSTEM SHALL set `Not assessed`. (The below-base and unknown-base branches are the author's reading of the review table and need developer confirmation: **TBD**.)

4.6 THE SYSTEM SHALL define the forecast criterion as IFS temperature at the planned altitude within a lower and upper bound and relative humidity at or above a threshold. The existing `ifs-temperature-rh-v1` uses −25 °C to 0 °C and 85 %; the candidate layer here uses −20 °C. Which temperature range applies to the forecast criterion is **TBD**. The values used SHALL be echoed in the response `thresholds` object and described as uncalibrated screening values.

4.7 THE SYSTEM SHALL convert the planned altitude to pressure with the standard atmosphere when sampling IFS at the planned altitude, and SHALL record this in `forecast`.

4.8 THE SYSTEM SHALL NEVER set `Not indicated` for a sample whose evidence is unavailable, and SHALL NEVER set `Not indicated` when `retrievalState` is one of those listed in 4.1.

4.9 THE SYSTEM SHALL NOT output a severity, intensity or probability of icing, and SHALL keep `icingRisk: null`.

4.10 THE SYSTEM SHALL set per-sample `icingExposure` to `true` only for `Observed supercooled layer at planned altitude` and leave it `null` otherwise. (Value semantics for existing field: **TBD**.)

### 5. Route summary

**User story:** As a dispatcher, I want the route summarised as distances per evidence level, so that I can brief it without a single worst-case badge.

Acceptance criteria:

5.1 THE SYSTEM SHALL return `routeSummary.levels`, an object with one entry for each of the four evidence levels, each holding `km` and `segments`.

5.2 THE SYSTEM SHALL assign each sample the interval from the midpoint to its previous sample (or 0 km for the first sample) to the midpoint to its next sample (or the last distance for the last sample), and SHALL derive `km` and segment `startKm` / `endKm` from these intervals.

5.3 THE SYSTEM SHALL merge adjacent samples with the same evidence level into one segment with `startKm`, `endKm`, `sampleCount`, `minPlannedAltFt` and `maxPlannedAltFt`.

5.4 THE SYSTEM SHALL return level kilometres whose sum equals the route length to within 0.001 km.

5.5 THE SYSTEM SHALL NOT return a single "worst" or "highest" level, a risk badge value, or any ranking of levels.

### 6. API and viewer contract

Acceptance criteria:

6.1 THE SYSTEM SHALL add the new fields to `GET /api/icing/cross-section` without removing or renaming any field of the existing response.

6.2 THE SYSTEM SHALL keep `icingRisk: null` and keep the `assessmentState` field. Its values SHALL extend to `assessed`, `partial` and `not_assessed`. (Value set: **TBD**.)

6.3 THE SYSTEM SHALL include `ruleName` and `ruleVersion` at the top level of every response, and a timezone-aware UTC `observedAt`, `source`, and `forecast` provenance. Rule name and first version value: **TBD**.

6.4 THE SYSTEM SHALL return responses that pass the `validProfile()` rules in `static/viewer.js`: `title`, `source` non-empty; `dataKind` of `simulated` or `observation`; `observedAt` as `YYYY-MM-DDTHH:MM:SS[.fff]Z` for observations; 2 to 2000 samples; first `distanceKm` equal to 0 and strictly increasing; `baseFt` not above `topFt`; `phase` in `liquid`, `ice`, `unknown` or null; `supercooled` true, false or null; no phase or supercooled value when `topFt` is null.

6.5 WHEN the cache is missing, corrupt or stale for the default selection, THE SYSTEM SHALL keep returning the labelled simulated profile, and the new fields SHALL be present with `evidenceLevel: "Not assessed"` and `evidenceReason: "simulated_profile"` for every sample.

6.6 THE SYSTEM SHALL add optional query parameters for the flight profile (1.5) and SHALL keep the five existing required parameters and their validation unchanged.

6.7 WHEN a response contains per-sample new fields, THE SYSTEM SHALL name them: `plannedAltFt`, `etaUtc`, `etaOffsetMin`, `zeroCFt`, `minus20CFt`, `isothermMethod`, `candidateLayer`, `candidateLayerBasis`, `candidateLayerReason`, `forecastCriterion`, `evidenceLevel`, `evidenceReason`. Field names are a proposal for Kiro to confirm.

### 7. IFS collection

Acceptance criteria:

7.1 THE SYSTEM SHALL collect IFS pressure levels 925 and 700 hPa in addition to 850, 500, 300 and 250 hPa, for the fields `gh`, `t`, `r`, `u`, `v`.

7.2 WHEN the collector builds a bundle, THE SYSTEM SHALL verify that the number of selected GRIB messages equals fields times levels and SHALL fail the run otherwise, as it does today.

7.3 THE SYSTEM SHALL keep bundles collected with four levels readable by `src/integration/ifs_grid.py`.

7.4 THE SYSTEM SHALL keep the collected bundle schema version at 1 unless a field changes. (Confirm: **TBD**.)

### 8. Determinism and provenance

Acceptance criteria:

8.1 THE SYSTEM SHALL return identical output for identical inputs (route, profile parameters, frame, IFS bundle, rule version), apart from request-time fields such as `ageMin`.

8.2 THE SYSTEM SHALL NOT call any language model, network service or random number source while computing evidence levels.

8.3 THE SYSTEM SHALL include in every response the satellite source, frame observation time in UTC, IFS initialization and receipt times when IFS was used, and the rule name and version.

8.4 Units SHALL be feet MSL for altitude, km for distance, kelvin internally and °C in displayed fields, and UTC for all times.

## Out of scope

- Icing severity, intensity or probability, and aircraft-type effects.
- Wind in ETA, terrain clamping of cloud base (see 3.5), WAFS or GK-2A ICING product ingestion.
- Altitude suggestions or alternative routes.
- Fuel calculation and candidate-route ranking (frozen; see the review, section 4.2).
- Frame-to-frame comparison (covered by the `replay-and-ui` spec).

## Open decisions (all TBD)

1. Default climb rate, descent rate and ground speed.
2. Forecast criterion temperature range (−25 or −20 °C lower bound) and humidity threshold.
3. Below-base and unknown-base handling in 4.5.
4. `assessmentState` value set and `icingExposure` semantics.
5. Rule name and version string.
6. Terrain clamping of cloud base.
7. Whether geopotential height is treated as geometric height (difference ignored).
