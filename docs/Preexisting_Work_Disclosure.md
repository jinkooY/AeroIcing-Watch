# Pre-existing work disclosure

Kiroween 2026 rule: "Projects must be newly created ... after the start of the
Hackathon Submission Period" and "must disclose any other pre-existing code or
work incorporated." Draft of 2026-11-13. The owner confirms each statement.

## 1. Timeline

- Submission period starts 2026-10-30. The first commit in this repository is
  `c426a64` on 2026-11-11 23:13 (local time), inside the period.
- The viewer commit `610e383` (2026-11-11 23:19) and the backend files first
  committed in `257f7d8` existed before the Kiro commits. Git does not record
  which tool wrote them; the owner states that Claude wrote them (section 3).

## 2. WeatherPath code (the owner's earlier project)

Method, evidence and limits are in
[`WeatherPath_Reuse_Audit.md`](WeatherPath_Reuse_Audit.md). In short:

- Copied: `noh_cloud_base_km`, `night_cloud_water_gm2`, `solar_zenith_deg`,
  `apparent_latlon` and the Noh and night tables in `src/analysis/cloud_base.py`.
- Adapted: `estimate_base`, the grid and parallax lookup in
  `src/analysis/icing_profile.py`, and the ECMWF index selection in
  `tools/collect_ifs.py`.
- Depends on WeatherPath: the GK-2A cache format
  (`src/integration/gk2a_cloud.py`) and `tools/import_weatherpath_ctps.py`.

**Licence statement (owner, 2026-11-13):** the WeatherPath repository has no
licence file. The owner is its author and releases the copied and adapted parts
in this repository under the Apache-2.0 licence of this repository.

## 3. AI tool attribution

How the labels were derived:

- **Claude**: the commit carries a `Co-Authored-By: Claude ...` trailer.
- **Codex**: the commit is on branch `codex/kiroween-route-demo`; the
  submission notes name Codex. Codex commits have no trailer, so this label
  rests on the branch and the notes.
- **Kiro**: commits made in the Kiro session. In `257f7d8` only the files the
  Kiro session wrote or edited are labelled Kiro.
- **Claude (owner-stated)**: files that carry no `Co-Authored-By` trailer because they
  were committed by the owner or by the Kiro commit `257f7d8` (backend files that
  existed uncommitted, and the viewer commit `610e383`), or were imported by Claude's
  commit `10298ce`. Git cannot tell which tool wrote them. **The owner states
  that all of them were written by Claude (2026-11-13).**
- **GitHub repository creation**: `LICENSE` (Apache-2.0 template) and the one-line
  `README.md` of the initial commit `c426a64`.
- **Kiro draft, committed by Claude**: `10298ce` contains five files identical
  to the Kiro draft; Claude then corrected and extended them
  (`b9f3d82` to `908210e`).
- Two branches are not merged and not part of this entry: the 3D replay
  (`claude/aeroicing-watch-3d-review-340178`) and the research review
  (`claude/kiro-research-direction-review-b971c3`).

## 4. Legacy components

Legacy files stay in the repository and in git history but are outside the
Kiroween entry: GK-2A and WeatherPath import, Meteosat and Himawari sources,
the fuel route review (OpenAP), flight lookup, the Incheon-Haneda route
comparison demo, and the night cloud-water path in `cloud_base.py`. Decision
W2 (2026-11-13) removed the route comparison and fuel model from scope.
`src/analysis/route_weather.py` is legacy for its fuel code; its temperature
and humidity screen may be re-implemented for the ECMWF background.

## 5. Third-party data and libraries

ECMWF Open Data IFS (CC BY 4.0); NOAA GOES-R ABI Level-2 on AWS (public);
Himawari-9 AHI Level-2 (NOAA mirror, legacy); Iowa Environmental Mesonet PIREP
archive (NWS reports); Noh et al. (2017) cloud-base method; CIRA aviation
cross-section product as a referenced prior work (no code or images used);
OpenAP (LGPL-3.0, legacy); FastAPI, uvicorn, numpy, netCDF4, pyproj, requests.

Added with revision b (details, version and SHA-256 in
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)): **three.js 0.160.1** (MIT), one
vendored module file in `static/cloud-dive/vendor/three/`, taken unchanged and not loaded from
a CDN; **OurAirports** open data (public domain), the source of `airports.json` and of the
airport elevations in the case files. Natural Earth (public domain) supplies the basemap lines
in `static/cloud-dive/cases/basemap.json`. The GOES images in the case files are derived from
NOAA GOES-R ABI Level-2 and CMI data.

## 6. Per-file table

Status: `legacy` = outside the entry. WeatherPath: result of the reuse audit.
Origin chain: oldest first.

| File | Status | WeatherPath | Origin chain |
|---|---|---|---|
| `.env.example` | active | - | Claude (owner-stated) -> Claude |
| `.github/workflows/route-demo-pages.yml` | legacy | - | Codex |
| `.gitignore` | active | - | Kiro |
| `.kiro/hooks/session-start-status.json` | active | - | Kiro |
| `.kiro/hooks/task-progress-tracker.json` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/backend-first-plan.md` | active | - | Claude (owner-stated) |
| `.kiro/specs/aeroicing-watch/design.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/global-satellite-design.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/implementation-scope.md` | active | - | Kiro -> Claude (owner-stated) |
| `.kiro/specs/aeroicing-watch/requirements.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/tasks.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/design.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/requirements.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/submission-checklist.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/tasks.md` | active | - | Kiro |
| `.kiro/steering/project.md` | active | - | Kiro |
| `LICENSE` | active | - | GitHub repository creation |
| `README.md` | active | - | GitHub repository creation (one line) -> Claude (owner-stated) -> Kiro -> Claude -> Codex |
| `airports.json` | active | - | Kiro -> Kiro draft, committed by Claude |
| `docs/AeroIcing_Watch_About_the_Project.md` | active | - | Claude (owner-stated) -> Kiro |
| `docs/AeroIcing_Watch_Submission_Package.md` | active | - | Claude (owner-stated) -> Kiro -> Codex |
| `docs/Flight_Metadata_Lookup.md` | active | - | Claude (owner-stated) |
| `docs/Global_Satellite_Status.md` | active | - | Claude |
| `docs/IFS_Route_Evaluation.md` | active | - | Claude (owner-stated) |
| `docs/WeatherPath_Port_Inventory.md` | active | - | Claude (owner-stated) |
| `docs/WeatherPath_Reuse_Audit.md` | active | - | Kiro |
| `frontend/app.js` | active | none found | Kiro -> Claude |
| `frontend/index.html` | active | none found | Kiro -> Claude -> Codex |
| `frontend/vendor/.gitkeep` | active | - | Claude (owner-stated) |
| `main.py` | active | none found | Claude (owner-stated), then Kiro edits |
| `requirements.txt` | active | - | Claude (owner-stated) -> Claude |
| `src/__init__.py` | active | none found | Claude (owner-stated) |
| `src/analysis/__init__.py` | active | none found | Claude (owner-stated) |
| `src/analysis/aircraft_performance.py` | legacy | none found | Claude (owner-stated) |
| `src/analysis/cloud_base.py` | active (night path legacy) | copied | Claude (owner-stated) -> Claude |
| `src/analysis/icing_profile.py` | active | adapted | Claude (owner-stated), then Kiro edits -> Kiro draft, committed by Claude -> Claude |
| `src/analysis/route_sampler.py` | active | none found | Claude (owner-stated) |
| `src/analysis/route_weather.py` | legacy | none found | Claude (owner-stated) |
| `src/analysis/satellite_router.py` | active | none found | Kiro draft, committed by Claude -> Claude |
| `src/api/__init__.py` | active | none found | Claude (owner-stated) |
| `src/api/icing.py` | active | none found | Claude (owner-stated), then Kiro edits -> Claude |
| `src/api/route_review.py` | legacy | none found | Claude (owner-stated) |
| `src/integration/__init__.py` | active | none found | Claude (owner-stated) |
| `src/integration/flight_lookup.py` | legacy | none found | Claude (owner-stated) |
| `src/integration/geogrid.py` | active | none found | Claude |
| `src/integration/gk2a_cloud.py` | legacy | cache-format dependency | Claude (owner-stated) -> Claude |
| `src/integration/goes_cloud.py` | active | none found | Kiro draft, committed by Claude -> Claude |
| `src/integration/himawari_cloud.py` | legacy | none found | Claude |
| `src/integration/ifs_bbox.py` | active | none found | Claude |
| `src/integration/ifs_grid.py` | active | none found | Claude (owner-stated) -> Claude |
| `src/integration/meteosat_cloud.py` | legacy | none found | Kiro draft, committed by Claude -> Claude |
| `static/route-demo/app.js` | legacy | none found | Codex |
| `static/route-demo/index.html` | legacy | none found | Codex |
| `static/route-demo/scenario.json` | legacy | - | Codex |
| `static/route-demo/styles.css` | legacy | none found | Codex |
| `static/sample.js` | active | none found | Claude (owner-stated) |
| `static/styles.css` | active | none found | Claude (owner-stated) |
| `static/viewer-standalone.html` | active | none found | Claude (owner-stated) |
| `static/viewer.js` | active | none found | Claude (owner-stated), then Kiro edits |
| `tests/test_flight_lookup.py` | legacy | none found | Claude (owner-stated), committed by Claude |
| `tests/test_global_satellite.py` | active | none found | Claude |
| `tests/test_icing_api.py` | active | none found | Claude (owner-stated), committed by Claude |
| `tests/test_ifs_route.py` | legacy | none found | Claude (owner-stated), committed by Claude |
| `tests/test_pacific_coverage.py` | active | none found | Claude |
| `tools/build_airports.py` | active | none found | Kiro draft, committed by Claude |
| `tools/collect_goes.py` | active | none found | Claude |
| `tools/collect_himawari.py` | legacy | none found | Claude |
| `tools/collect_ifs.py` | active | adapted | Claude (owner-stated), committed by Claude -> Claude |
| `tools/export_route_demo.py` | legacy | none found | Codex |
| `tools/import_weatherpath_ctps.py` | legacy | runtime dependency | Claude (owner-stated), committed by Claude |
| `tools/validate_ifs_icing.py` | legacy | none found | Claude (owner-stated), committed by Claude |

## 7. Cloud Dive files written in this entry (tasks 1 to 19)

Section 6 lists the files that existed before the Cloud Dive spec. Every file below was
created or rewritten by Kiro spec task execution inside the submission period; each task has a
row in [`kiro-usage-log.md`](kiro-usage-log.md). The task number is in the usage log, not
repeated here. No file in this section is copied from WeatherPath (the reuse audit is in
section 2). Status is `active` for all of them. List compiled on 2026-11-14 from `git ls-files`
and `git status` (revision b files are not yet committed at the time of writing, so the owner
runs `git log --follow` on any file to check the final commit).

### 7.1 Revision a: game engine, cases and 2D game (Kiro)

| Files | Origin |
|---|---|
| `src/analysis/evidence.py`, `ifs_cube.py`, `lanes.py`, `cost_model.py`, `game_core.py`, `solver.py`, `case_builder.py`, `case_io.py`, `goes_lane_sampler.py` | Kiro |
| `src/integration/goes_conus.py` | Kiro |
| `tools/export_cloud_dive.py`, `export_map_images.py`, `build_basemap.py`, `check_viewer_contract.py`, `tune_params.py`, `make_goes_fixture.py`, `tools/layout_check.mjs`, `tools/cloud_dive_cases/*.json` (manifests) | Kiro |
| `static/cloud-dive/engine.js`, `controller.js`, `controls.js`, `render.js`, `map.js`, `report.js`, `report-view.js`, `view-helpers.js`, `why.js`, `game.js`, `game.css`, `index.html` | Kiro |
| `static/cloud-dive/cases/*.json`, images and basemap | Kiro (generated by `tools/export_cloud_dive.py` and `tools/export_map_images.py` from NOAA and ECMWF data) |
| `tests/test_evidence*.py`, `test_game_*.py`, `test_solver.py`, `test_lanes.py`, `test_ifs_cube.py`, `test_goes_*.py`, `test_export_*.py`, `test_build_basemap.py`, `test_viewer_contract.py`, `test_engine_parity.py`, `test_api_compat.py`, `test_dispatcher_evidence.py`, `test_wording.py`, `tests/js/*.mjs`, `tests/fixtures/`, `tests/*_synthetic.py` | Kiro |
| `.kiro/hooks/*` (pytest, node check, protect `.env` and `data/`, wording, session start, task progress), `.kiro/steering/*`, the `cloud-dive` spec | Kiro |

Existing files that Kiro edited for the game: `tools/collect_ifs.py` (levels, retry),
`src/api/icing.py` and `static/viewer.js` (dispatcher view shows evidence levels, the profile
contract is unchanged), `.github/workflows/route-demo-pages.yml` (now publishes the game),
`requirements.txt`, `.gitignore`.

### 7.2 Revision b: 3D cockpit, phases, hot-seat, chase view (Kiro)

All files below are new in revision b. Origin: Kiro (spec task execution, not Claude, not Codex).

| File | Purpose |
|---|---|
| `static/cloud-dive/scene.js` | DOM-free scene description (frame, cloud volumes, evidence bands, effects, panel data) |
| `static/cloud-dive/cockpit3d.js` | three.js drawing of the scene description |
| `static/cloud-dive/cockpit-geometry.js` | windshield frame and panel built from primitives |
| `static/cloud-dive/cockpit.css` | cockpit overlay styles |
| `static/cloud-dive/panel.js` | cockpit panel overlay data and text |
| `static/cloud-dive/gate-controls.js`, `gate-panel.js` | gate choices mapped to the controller |
| `static/cloud-dive/cruise-camera.js` | cruise camera and gate stop |
| `static/cloud-dive/phases.js` | phase machine: takeoff, climb, cruise, gate, arrival, diversion, report |
| `static/cloud-dive/takeoff.js` | runway lead-in, skip and ending handling |
| `static/cloud-dive/departure.js`, `departure-card.js` | departure climb constant and the 2D status card |
| `static/cloud-dive/fuel-counter.js`, `cost-popup.js` | fuel counter and "+$N this segment" pop-up |
| `static/cloud-dive/hotseat.js` | hot-seat session and results table |
| `static/cloud-dive/chase.js` | chase camera and generic aircraft model from primitives |
| `static/cloud-dive/view-mode.js`, `webgl-test.js` | view switch and WebGL check |
| `src/analysis/departure.py`, `tools/export_departure.py` | departure climb constant and airport elevations in the case files |
| `tests/js/` `scene`, `cockpit3d`, `panel`, `gate-controls`, `phases`, `takeoff`, `skip`, `climb`, `cinematics`, `effects`, `hotseat`, `chase`, `cruise-camera`, `fuel-counter`, `cost-popup`, `departure-card` `.test.mjs` | Node tests |
| `tests/test_departure.py`, `tests/test_playtest_regression.py` | pytest |
| `tools/chase_check.mjs`, `tools/hotseat_check.mjs` | headless browser checks |
| `docs/screens/15.6-*`, `17.8-*`, `18.4-*`, `19.2-*` | screenshots and measured frame-rate files from those checks |
| `THIRD_PARTY_NOTICES.md` | three.js and OurAirports entries |

Edited in revision b: `game.js`, `game.css`, `index.html`, `render.js`, `controls.js`,
`report.js`, `report-view.js`, `why.js`, the three case files (added `params.departureClimbUsd`,
`params.departureClimbNote` and `airports` only), `tests/test_wording.py`, `tests/js/report.test.mjs`,
`tools/layout_check.mjs`.

`static/cloud-dive/vendor/three/three.module.min.js` and its `LICENSE` are third-party files
(section 5), not Kiro work. The `airports.json` origin chain stays as in section 6; its
elevations come from OurAirports.

### 7.3 What Kiro did not write

Nothing in section 7 was written by Claude or Codex. Claude and Codex files remain as
labelled in section 6. The owner reads section 7 and confirms it (checklist C4); until then it
is a draft. The video, the Devpost form and the write-up are owner tasks.
