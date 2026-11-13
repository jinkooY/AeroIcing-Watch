# Pre-existing work disclosure

AeroIcing Watch was started on 2026-11-11 (first commit in this repository, within the Kiroween 2026 submission period). Some algorithms were taken from an earlier project, WeatherPath (repository `hackerton_2026`, same author). This table lists what was ported or adapted from WeatherPath and what was written for this project.

Basis: `docs/WeatherPath_Port_Inventory.md` (WeatherPath source commit `4d3c907a`), file headers and comments in this repository, and the files themselves as of 2026-11-12. Rows marked "to confirm" could not be settled from the files alone; the author must confirm line-level origin before this goes into the README.

Status of the repository at the time of writing: only part of this code is committed. The committed history is `c426a64` (initial commit), `610e383` (standalone viewer), `8745bb8` (Kiro spec and steering), `71514ac` (implementation scope). The server, analysis, integration and tool files below are uncommitted in the main checkout. Commit dates TBD.

## Ported or adapted from WeatherPath

| Component | File in this repository | Origin and evidence | Status |
| --- | --- | --- | --- |
| Cloud-base estimation (Noh et al. 2017 tables, cirrus extinction, deep-convection test, night cloud-water-path proxy, night thickness table) | `src/analysis/cloud_base.py` | File header: "Adapted from WeatherPath satellite_cross_section.py and gk2a_cloud.py". Inventory lists these as an extraction from `satellite_cross_section.py`. | Ported/adapted |
| Cloud-top parallax correction (`apparent_latlon`) | `src/analysis/cloud_base.py` | Inventory lists it as extracted from `satellite_cross_section.py`. | Ported/adapted |
| Solar zenith angle and daytime test | `src/analysis/cloud_base.py` | Inventory lists `solar_zenith_deg` from `gk2a_cloud.py`; the daytime wrapper `is_gk2a_daytime` is described as adapted. Whether the wrapper is new: to confirm. | Ported/adapted; wrapper to confirm |
| Combined base estimate function `estimate_base` | `src/analysis/cloud_base.py` | Orchestrates the ported pieces. No origin stated in the file. | To confirm |
| Grid lookup (`_latlon_to_rc`, Mercator rows) and parallax-corrected pixel lookup (`_pixel_for`) | `src/analysis/icing_profile.py` | Inventory lists `_latlon_to_rc` (`cloud_struct.py`), `_mercator_lats` (`overlay_fetcher.py`) and `_pixel_for` (`satellite_cross_section.py`) as sources to extract. The file has no header comment. | To confirm (likely adapted) |
| GK-2A projected-cache reader (schemas 2–4, optional `supercooled` and `emis11`, optics schema 1) | `src/integration/gk2a_cloud.py` | File header: "Read-only WeatherPath-compatible GK-2A projected caches". Inventory says the cache read was to be ported. Whether code was copied or rewritten against the same cache format: to confirm. | To confirm |
| IFS index selection and scan-direction-aware cropping | `tools/collect_ifs.py` | Code comment: "adapted from WeatherPath ecmwf_highres.py and tools/ecmwf_highres/archive.py at b9caa0f1". The docs also say the collector follows the WeatherPath 0.25° profile parameter list. | Adapted |
| Offline importer that projects a WeatherPath raw CTPS NetCDF frame into this project's cache | `tools/import_weatherpath_ctps.py` | Written here, but it imports WeatherPath modules at run time from a local WeatherPath checkout (adds it to `sys.path`) and reads WeatherPath's raw `.nc` archive. It is not self-contained. | New code that depends on WeatherPath |
| Archived demo profile (RKSI–RKPC, 2026-09-01 13:24 UTC, 30 samples) | `data/demo/gk2a-ctps-202609011324-rksi-rkpc.json` (git-ignored) | Built from a raw CTPS file in the WeatherPath archive. The README states the cloud bases are WeatherPath estimates. | Derived from WeatherPath data and code; not committed |
| Satellite cache frames | `data/overlay/gk2a_l2/` (git-ignored) | Contents come from the WeatherPath archive via the importer. Redistribution terms for KMA files: to confirm. | Derived from WeatherPath data; not committed |

## Third-party code and data used (not WeatherPath)

| Component | Where | Note |
| --- | --- | --- |
| OpenAP 2.4 (aircraft and fuel model) | `requirements.txt`; a local copy sits under `data/ifs-python/openap/` (git-ignored) | The bundled `data/ifs-python/openap/data/LICENSE` file in that copy is GNU GPL v3, while this repository is Apache-2.0. Compatibility not established; the review lists this as an open item. The fuel feature is frozen. |
| ECMWF Open Data IFS forecasts | `tools/collect_ifs.py`, `data/ifs/` | Public data; attribution required. |
| KMA/NMSC GK-2A CTPS L2 | cache and demo profile | Attribution required; redistribution terms to confirm. |
| Noh et al. (2017) | cloud-base method | Cited method; coefficients were carried over via WeatherPath. |
| Python libraries | `requirements.txt` | FastAPI, uvicorn, numpy, netCDF4, pyproj, requests, python-dotenv, openap. |

## Written for this project

| Component | File | Evidence and status |
| --- | --- | --- |
| Standalone Canvas viewer and profile validator (`validProfile()`), sample profile, styles | `static/viewer.js`, `static/sample.js`, `static/styles.css`, `static/viewer-standalone.html` | Committed in `610e383` (moved from the repository root in the working tree). No WeatherPath reference found in these files. Whether any code was copied from WeatherPath's frontend: to confirm. |
| Kiro spec, steering, implementation scope | `.kiro/` | Committed (`8745bb8`, `71514ac`). New specs in this folder: TBD (committed or not). |
| FastAPI entry point and `/health` | `main.py` | Uncommitted; no WeatherPath reference found. |
| Observation API (`/api/icing/frames`, `/status`, `/cross-section`), freshness window, simulated fallback | `src/api/icing.py` | Uncommitted; written for the Kiro contract. Inventory says the request validation in WeatherPath's `satellite_section.py` was used "as a reference". Degree of reuse: to confirm. |
| Route sampler (WGS84 geodesic, 10–200 samples) | `src/analysis/route_sampler.py` | Uses `pyproj.Geod`. Inventory says the Haversine calculation in WeatherPath could be reused; this file does not use Haversine. Likely new: to confirm. |
| Per-sample retrieval state and quality logic, profile assembly (`build_profile`) | `src/analysis/icing_profile.py` | Inventory says WeatherPath's `_column` and `_cloud_top_observation_state` were references. Degree of reuse: to confirm. |
| IFS bundle reader and interpolation | `src/integration/ifs_grid.py` | Docs say the API "follows the WeatherPath source without importing it at runtime". Degree of reuse: to confirm. |
| IFS temperature and humidity screen, fixed-flight-level route evaluation | `src/analysis/route_weather.py` | Uncommitted. Frozen feature (fuel part). Origin of the screen: new per docs; to confirm. |
| Aircraft and engine catalog, route-review API, flight metadata lookup, label validation tool | `src/analysis/aircraft_performance.py`, `src/api/route_review.py`, `src/integration/flight_lookup.py`, `tools/validate_ifs_icing.py` | Uncommitted. Frozen features (fuel, flight lookup). New per docs; to confirm. |
| Tests | `tests/test_icing_api.py`, `tests/test_ifs_route.py`, `tests/test_flight_lookup.py` | Uncommitted; written for this project per the docs. WeatherPath's own tests were run to check source behaviour, not copied (per inventory); to confirm. |
| Icing layer fusion, flight profile, evidence levels | to be built (`.kiro/specs/icing-layer-fusion/`) | Planned; not yet implemented. |
| Frame-to-frame replay, new UI | to be built (`.kiro/specs/replay-and-ui/`) | Planned; not yet implemented. |

## Notes for the README

- WeatherPath has no tracked repository-level license file in its HEAD (per the inventory). Reuse and redistribution terms for the ported code and for the satellite fixtures must be confirmed before they are published with the demo.
- Items under "Frozen" in the review (fuel ranking, flight lookup, cost measurement) are present in the working tree but are not part of the submission scope.
- Fill the commit hashes for each row once the working tree is committed. TBD.
