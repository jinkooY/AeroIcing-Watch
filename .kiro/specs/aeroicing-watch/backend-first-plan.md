# AeroIcing Watch — Feasibility and backend-first implementation plan

Updated 2026-11-12 (KST). This plan sets the build order for the route-comparison and in-flight review prototype. The original [requirements](requirements.md), [design](design.md), and [tasks](tasks.md) remain the reference for the standalone viewer and its profile contract. This plan takes precedence for the expanded scope, hazard interpretation, and delivery order.

## Product and first demonstration

AeroIcing Watch helps a ground dispatcher review changes along the remaining route, compare a baseline with allowable alternatives, and decide which candidate to review or select. It combines cloud observations, forecast winds, icing and turbulence, and estimated trip fuel in one evidence trail.

The first demonstration replays a past scenario. It starts with a saved route, advances a simulated aircraft position, brings in the next archived satellite frame or forecast snapshot, and recomputes only the remaining route. A meaningful change identifies the affected segment, planned altitude, ETA, data source and time, and whether the recommendation changed. The result shows the reason to keep, replace, or withhold a recommendation. Candidate comparison uses an explicit list of pre-reviewed airway and altitude combinations. Operational filing, live cockpit delivery, and unrestricted route generation belong to a later scope.

## Baseline and feasibility

| Area | Evidence and feasibility | First build decision |
| --- | --- | --- |
| App baseline | Phase 1 FastAPI scaffold and standalone JSON/Canvas viewer work locally. The local RKSI–RKPC archive export contains 30 samples and four CTPS supercooling cues. The export is a prepared profile. It cannot resample arbitrary routes or replay successive frames by itself. | Reuse the viewer contract and offline entry point. Produce a comparable profile on demand from an archived CTPS grid and identify additional consecutive frames for replay. |
| Satellite input | The WeatherPath raw CTPS archive retains `CP_FLAG`. The sampled legacy projected cache lacked the flag and matched DCOEW. Current KO projected-grid coverage ends at 134.5°E and excludes Tokyo. | Use RKSI–RKPC for the first real-observation check. Use RKSI–RJTT to exercise coverage gaps and a clearly labelled synthetic comparison until the full route has suitable forecast coverage. Confirm broader CTPS/ICING coverage and ingest latency from actual files. |
| Current hazard evidence | KMA lists `ICING` for the Korean Peninsula and extended area, using satellite data, UM and supporting observations. `TFTD` combines satellite data and UM to indicate turbulence associated with tropopause folds. Their actual delivery, quality and coverage for the chosen case remain to be checked. | Start with CTPS for cloud top, phase and supercooling cues. Add ICING and TFTD adapters after sample-file inspection. Display the original classification, quality and pressure/height metadata where available. Keep TFTD evidence distinct from a general turbulence severity or EDR field. |
| Forecast coverage | Global WAFS offers flight-level icing and turbulence grids with product-specific level and validity limits, and authorized access. The publicly documented WAFS icing grid spans FL050–FL300. | Verify access, redistribution, time, levels, and actual coverage for the proposed case. Keep missing or out-of-range hazards unassessed. Use a labelled deterministic fixture for the full route comparison until real coverage is verified. |
| Route and fuel | A small allowlist of routes and altitude profiles can be evaluated exhaustively. An aircraft model such as OpenAP supports estimated fuel flow. The actual flight result depends on aircraft, weight, speed, winds and route constraints. | Begin with one aircraft model and versioned input assumptions. Fix the available routes and climb/descent profile for the demo and include the remaining portions of those phases in the cost. |
| Market and economics | Lido Flight 4D and ClearPath already offer in-flight support. ForeFlight Dispatch uses annual per-aircraft quotes, and Met Office 4DT is priced per request. The comparable enterprise unit cost has not been established. | Position the product around traceable changes on East Asia routes and shared data processing. Measure fewer upstream fetches, bytes and time to verify a decision. Keep statutory aviation weather charges, subscription savings and realized fuel savings out of demo results. |

The engineering prototype is feasible with existing archives and synthetic forecast fixtures. Full-route real-data comparisons, live update latency, commercial data rights and operational performance remain separate validation items.

### Cost hypothesis

Reusing a regional frame across flights and alternatives can reduce duplicate downloads, transfers and processing. Compare the same scenario and outputs under per-route retrieval and shared-cache retrieval. Convert the measured difference to money only when the supplier's billing units and cache rights are known. Track any review time saved separately from cash savings and record integration and maintenance effort.

Public reference prices include $400 per license per year for ForeFlight Business Performance with a two-license minimum, and $12–24 per month for a single 2–4 GB Lightsail instance. The former covers a bundled application, and the latter is a prototype compute line item. ForeFlight Dispatch and trajectory API pricing require separate quotes or unit rates to establish a comparable baseline. Use statutory meteorological charges as background only. [ForeFlight Business](https://www.foreflight.com/pricing/business) · [AWS Lightsail](https://aws.amazon.com/lightsail/pricing/)

## Backend first

Complete these increments in order. FastAPI OpenAPI docs, CLI output and exported viewer JSON are sufficient to validate the backend.

### 1. Archived CTPS reader and observation API

Implemented for the KO cache on 2026-11-12. The 13:24 UTC RKSI–RKPC archived grid produced 30 samples and matched the prepared JSON for retrieval state, cloud top, estimated base, phase and supercooling. Real paired DCOEW and broader coverage remain to be checked. The [README](../../../README.md) contains the import and API commands.

- Adapt the cache-only readers and grid, parallax and cloud-base routines in the [WeatherPath port inventory](../../../docs/WeatherPath_Port_Inventory.md). Read shared inputs without modifying them. Decode or reproject raw NetCDF offline and publish complete cache entries atomically. Support the existing projected schemas and missing optional fields.
- Record product, domain, frame time, received time when known, source version, quality flags, and coverage. Key cached fields by product, domain and source frame or revision. Share one cached field across requests for different routes. Return the exact frame for explicit selections and expose freshness for the default selection.
- Implement the original `/api/icing/frames`, `/api/icing/status` and `/api/icing/cross-section` contract. Keep `validProfile()` compatibility. Add fields for retrieval state and cloud-base method where needed. Carry separately the states for clear, outside coverage, rejected retrieval, and missing cloud base.
- Treat CTPS phase and supercooling as cloud-top evidence. If estimating layer intersection, record its uncertainty and label the result as a satellite cue. A CTPS cue alone cannot clear or exclude a candidate under a forecast icing policy.
- **Completion check.** Build a profile for RKSI–RKPC from a real gridded CTPS frame. Compare it with the prepared JSON using consistent route sampling, time and method. Verify valid JSON on exact lookup, partial coverage and an empty cache. An empty cache may serve the original labelled synthetic viewer sample. Corrupt and stale inputs must remain distinguishable from verified clear pixels.

### 2. Route evaluation and fuel-based candidate ranking

First increment implemented for a caller-supplied route and one level-cruise
profile. The real IFS bundle, archive contract, evidence limits, and independent
label workflow are documented in [IFS route evaluation](../../../docs/IFS_Route_Evaluation.md).
The API evaluates one route per request. Candidate ranking, approved airway
presets, climb/descent profiles, and replay remain later increments.

Aircraft and engine selection now use the installed OpenAP catalog. The
[flight metadata adapter](../../../docs/Flight_Metadata_Lookup.md) is a
separate non-operational demo input with manual evaluation available independently.

- Load a versioned scenario with a baseline route, a small list of pre-reviewed airway paths, admissible altitude profiles, aircraft type, initial mass, speed profile and departure time. The East Asia case uses RKSI–RJTT as a target, subject to route source and coverage checks. Keep airway validity and altitude assumptions with the scenario.
- Evaluate each candidate along position, altitude and ETA through climb, cruise and descent. Advance time using forecast winds and groundspeed. Calculate segment fuel as fuel flow times duration, updating mass as fuel is consumed. Use one model and the same inputs when comparing alternatives. Store fuel in kg and time in seconds.
- Sample forecast wind, icing and turbulence at each candidate's own position, altitude and valid time. Keep forecast initialization and valid time distinct. Keep flight levels, geometric altitude and pressure coordinates explicit in adapters. Preserve each provider's hazard scale and record the evaluation policy and version. Initial thresholds belong to the labelled demo scenario.
- Distinguish candidates that meet the configured criteria, conflict with them, or lack critical evidence. Rank the assessed eligible candidates by lowest estimated remaining fuel, with a stable tie-breaker and ETA shown alongside. When none qualifies, return a review-needed result with affected segments. Keep official advisories identifiable as their own source if available.
- Expose the baseline and candidates with their assessments, differences, exclusion reasons and evidence references. Each candidate should link to a route profile that can be opened in the existing viewer.
- **Completion check.** Verify the same input yields the same rank and reasons. Cover a case where the lowest-fuel candidate is excluded for icing or turbulence, one with missing hazard coverage, and one with no eligible alternative. A changed departure time or wind should change the calculation when the underlying scenario warrants it. Use an independent segment calculation to check fuel and elapsed time on at least one controlled case.

### 3. In-flight replay, change detection, and cost measurement

- Store a baseline assessment and replay timestamped aircraft positions and data arrivals. Anchor the remaining route to the replay position and time. Keep past portions out of the recomputation. Compare changes with the previous assessment and display differences against the saved baseline.
- Store observation time, forecast issue and valid times, and availability to the app as separate fields. Use only data available at the replay decision time. If an archive lacks receipt times, use an explicit simulated delivery schedule and label it. Flag late, missing or stale updates. Compare changes on a consistent route segment or waypoint reference.
- Generate a review event when the recommendation or a decision-relevant segment changes. Return the before/after state, ETA and altitude, source or frame reference, and coverage. Show satellite changes as observational evidence and rerank candidates only when the applicable forecast or explicit scenario evidence changes their evaluated criteria. Replaying the same inputs should not duplicate events.
- Instrument upstream requests, bytes, cache hits, processing latency and query latency. Compare shared cache with an uncached baseline using the same input frames and candidate results. Separately time the dispatcher review task using identical scenarios. Retain observed measurements and assumptions about data charges, compute, integration and staff time.
- **Completion check.** Replay at least two archived CTPS frames and a simulated track. Exercise both a meaningful change and a missing-data event. Demonstrate a rank change using an explicitly identified forecast update or synthetic fixture. Test delayed data and confirm no look-ahead. Any published review-time or cost comparison should state the test setup and sample size.

### API handoff

Keep the planned `/api/icing/*` endpoints for observations. A small route review API can use `POST /api/route-review/evaluate` for a scenario and `GET /api/route-review/replays/{id}` for a stored or fixture-backed sequence. Define request/response schemas and examples before UI work. Include scenario ID, decision time, data mode, route and altitude profiles, reference and candidate metrics, eligibility reasons, segment evidence IDs, quality/coverage and source timing. A dataset's data mode should identify archived observation, forecast, or simulation at source level, with replay track origin visible separately.

The handoff includes OpenAPI schemas, runnable observed/partial/synthetic examples, tests and measurements, and a fixture with both a recommendation and a review-needed state. Use the existing cache-hit and fallback latency targets for the original cross-section API and measure route comparison separately. Bind tolerances to data resolution and state explicit UTC and unit conventions.

An AI explanation can follow after the deterministic outputs are stable. It can map a question to allowed replay or evaluation parameters, report only returned facts, and link to evidence IDs. The rank, exclusions, and fuel and hazard calculations are owned by the deterministic engine. A structured summary remains available when the explanation is unavailable.

## Frontend design and implementation after backend handoff

- Begin a separate design pass around the ground dispatcher workflow. Design the baseline and alternatives comparison, coordinated map and distance–altitude section, time controls, and a panel for the reason a route changed. Make warnings, forecast/observation/simulation labels and missing coverage legible without relying on color alone.
- Prototype the three key states first. Show an unchanged recommendation, a new segment requiring review, and a result with no eligible candidate. Use the same API fixtures for mockups and browser acceptance. Define how a selected route or evidence link changes both the map and the profile.
- Implement the chosen design after the backend examples and API contract are usable. Connect the existing Canvas viewer where its profile semantics fit. Browser acceptance should cover default route, candidate changes, replay, inaccessible data and keyboard interaction.

## Release and validation boundaries

Use a repeatable archived replay for the first demonstration. Live mode requires verified product access and licensing, characterized coverage, feed monitoring, measured capture-to-display delay, and usable behavior during outages. Withhold a ranking when critical inputs are missing. Validate forecast hazards against independent observations or authoritative assessments where available. Validate fuel against an appropriate reference for the aircraft and flight regime. Review the allowed route data, and disclose inherited WeatherPath code and data usage before public submission.

### Reference sources

- [KMA satellite product definitions, including CTPS, ICING and TFTD](https://api.nmsc.kma.go.kr/homepage/html/base/cmm/selectPage.do?page=static.convergence.utilizationProducts) and [KMA APIHub usage](https://apihub.kma.go.kr/apiInfo.do)
- [NOAA WIFS data coverage and access](https://aviationweather.gov/wifs/) and [SADIS license](https://www.metoffice.gov.uk/policies/aviation/sadis/sadis-api-licence-agreement)
- [OpenAP fuel model](https://openap.dev/fuel_emission.html)
- [Lido Flight 4D](https://www.lhsystems.com/solutions/operations-control-center/lido-flight-4d), [ClearPath](https://avtech.aero/clear-path-optimisation), and [CIRA satellite cloud cross-sections](https://aviation.cira.colostate.edu/introduction-faq)
- [ForeFlight Dispatch pricing basis](https://support.foreflight.com/hc/en-us/articles/360037193214-How-much-does-Dispatch-cost-and-how-do-we-subscribe) and [Met Office 4DT pricing basis](https://www.metoffice.gov.uk/services/transport/aviation/commercial/aviation-data-services/4dt)
