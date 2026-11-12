# AeroIcing Watch — WeatherPath port inventory

Reviewed on 2026-11-12 (KST). AeroIcing Watch baseline: `71514ac` in `C:/Users/I7-JIN/PycharmProjects/aeroicing-watch`. WeatherPath source: `4d3c907a` in `C:/Users/I7-JIN/PycharmProjects/hackerton_2026`.

Use the [Kiro requirements](../.kiro/specs/aeroicing-watch/requirements.md), [design](../.kiro/specs/aeroicing-watch/design.md), [implementation scope](../.kiro/specs/aeroicing-watch/implementation-scope.md), and [tasks](../.kiro/specs/aeroicing-watch/tasks.md) for implementation. This inventory records source findings and decisions still needed.

## Baseline before Phase 1

- `aeroicing-watch` contains the Kiro spec and steering files. `Kiro_aeroicing_watch` points to the same origin and is at `610e383`, the earlier standalone viewer commit.
- The existing HTML/Canvas viewer ships with a simulated profile and supports local JSON import, schema validation, a sample selector, and separate markers for missing tops and bases. `node --check` passed for `viewer.js` and `sample.js`. Browser interaction was reviewed in source.
- Phase 1 is partially started. `.gitignore` is already present and covers the Phase 1 ignore list. The FastAPI entry point, dependency manifest, `.env.example`, and target directory layout are pending. Phases 2–6 remain pending.
- The named WeatherPath conda environment has all seven requested distributions. NumPy is 1.26.4 and pyproj is 3.6.1. An AeroIcing Watch server smoke test remains pending.
- The existing WeatherPath satellite cross-section and GK-2A observation test files passed together (49 tests). This verifies the source behavior exercised by those tests.

Phase 1 is now complete. See the [README](../README.md) for launch and recording instructions. The recording profile was rebuilt from the local raw CTPS NetCDF, which retained the supercooling flags missing from the projected cache snapshot below.

## Port in Kiro task order

WeatherPath paths below are relative to the source checkout.

| Kiro task | WeatherPath source | AeroIcing Watch action |
| --- | --- | --- |
| 2.1, 4.1 | `src/integration/gk2a_cloud.py` — projected CTPS reader, frame index, status, and projected optics reader | Port cache reads first. Preserve support for CTPS schemas 2–4 and optional `supercooled` and `emis11`. Use cache-only reads for both CTPS and DCOEW. Accept an external cache root if consuming a WeatherPath fixture. Keep shared input files read-only. |
| 2.1 | `src/api/overlay_fetcher.py` — projection map, geolocation references, NetCDF locks and validation, HTTP throttle, atomic writes | Inline the dependency subset listed in Kiro only where the raw import/download path needs it. Audit the projection helpers for nested dependencies and reference files. Keep network calls, reprojection, and retention out of the request path. |
| 2.2–2.3 | `src/integration/gk2a_cloud.py` — `solar_zenith_deg`, KO grid constants. `src/analysis/cloud_struct.py` — `_latlon_to_rc`. `src/api/overlay_fetcher.py` — `_mercator_lats` | Adapt the daytime wrapper to accept location as Kiro specifies. Extract grid lookup with the source 500×620 Mercator grid and KO bounds. |
| 2.4 | `src/analysis/satellite_cross_section.py` — `apparent_latlon`, `_pixel_for`, Noh and night-CWP helpers and tables | Extract into `cloud_base.py`. Carry over DCOEW quality filtering, CWP/optical-depth handling, deep-convection unknown base, emissivity and median fallback, and the night-thickness branch. Keep `_NIGHT_PRECIP_PROB` as a source reference for task 2.4 and leave its rain overlay outside the icing output. |
| 3.1–3.2 | `src/analysis/satellite_cross_section.py` — `_route_km`. `src/analysis/mission_trajectory.py` — registry and waypoint normalization | Reuse the Haversine calculation. Implement great-circle interpolation in `route_sampler.py` with 15 km default and 10–200 samples. The existing satellite section interpolates coordinates linearly, uses ~2 km spacing, and caps length at 600 km. Build the public ICAO lookup from public airport data. |
| 3.3, 4 | `src/analysis/satellite_cross_section.py` — `_column`. `src/analysis/cloud_struct.py` — `_cloud_top_observation_state`. `src/api/routes/rksw/satellite_section.py` | Use the column processing, quality-state logic, and request validation as references. Write `icing_profile.py` and `src/api/icing.py` for the Kiro contract, including phase conversion, deterministic cue, UTC frame selection, and simulated fallback. |
| 5 | `frontend/vendor/leaflet/1.9.4/` | Vendor only if the optional map is built. Include the Leaflet license and required assets. Reuse the AeroIcing Watch Canvas viewer for the core UI. |

The steering reuse map lists `aviation_rules.py`. Its categories use visibility and ceiling for VFR/MVFR/IFR/LIFR. Phases 1–5 have no caller for those thresholds. Keep WeatherPath's RKSW pages, MOS/TAF, ECMWF/KIM, radar, LLM, operational registries, and worker deployment outside this port. WeatherPath HEAD has no tracked repository-level license file. Confirm reuse and redistribution terms for source and satellite fixtures before publishing them with the demo.

## Source findings that affect the first implementation

1. **Choose a demo route that intersects the cached grid.** The KO cache covers 32–44.5°N and 122–134.5°E. Kiro's ICN→NRT FL350 smoke case extends beyond the east edge. Use it to exercise partial coverage, and use an in-domain segment such as RKSI→RKPC to exercise the complete route sampling path.
2. **Get a fixture with the fields the demo needs.** The local source has 60 CTPS frames (2 schema-2 and 58 schema-3). The newest is 2026-09-01 13:24 UTC. All 60 lack a finite `supercooled` field, and the single DCOEW projected frame has no matching CTPS timestamp. Use these frames for legacy and missing-field checks. Obtain a schema-4 frame with populated `CP_FLAG` and a matched daytime DCOEW frame to verify those real-data branches. Use synthetic fixtures to test rule outcomes while waiting for observations.
3. **Preserve cache ownership and observation time.** The source reader deletes invalid projected files. Adapt that behavior for read-only shared fixtures. The source latest-frame helper uses a bounded backward search on a two-minute grid. Use exact cache lookup for an explicitly selected frame and define the default freshness window. Report the actual CTPS observation time. Test stale frames, corruption, and cache misses separately.
4. **Resolve missing evidence before implementing the risk badge and altitude suggestions.** Keep coverage gaps, unusable retrievals, missing cloud base, and verified clear pixels distinguishable. Kiro defines four rating levels but leaves the rating for insufficient evidence open. Keep the current viewer fields valid and use additive evidence/status fields if needed. Avoid presenting an unassessed part of the route as clear or suggesting an altitude through it. The scope also calls for terrain clamping, while task 2.4 specifies dependency-free cloud-base math. Decide how to supply the terrain floor, or explicitly document the estimate without it.
5. **Reconcile the Kiro wiring details.** `data/airports.json` is currently ignored and sits outside the proposed static mounts. Put the public table under `frontend/`, or explicitly track and serve that single asset. Requirements say to keep the viewer unchanged, while task 5.3 asks for additive overlays and readouts. Preserve `validProfile()` and the offline entry point, and limit any viewer additions to those fields. The design response example has one sample and a route rating unsupported by that sample. Replace it with a response that passes the viewer's two-sample minimum and the documented aggregation rule.

## Next testable increment

Complete Phase 1 in the Kiro checkout and verify `/health` plus the direct-file viewer. For Phase 2, demonstrate CTPS schema 2–4 reads, exact timestamps, and matched DCOEW reads from an isolated cache directory. Then verify Phase 3/4 profiles with an in-domain observation, a route leaving coverage, and an empty cache. Check all three profiles against the actual viewer validator and exercise the `/frames` and `/status` endpoints. Measure Kiro's response-time targets once the endpoints exist.
