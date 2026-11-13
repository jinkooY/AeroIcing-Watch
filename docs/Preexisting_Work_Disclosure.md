# Pre-existing work disclosure

Kiroween 2026 rule: "Projects must be newly created ... after the start of the
Hackathon Submission Period" and "must disclose any other pre-existing code or
work incorporated." Draft of 2026-11-13. The owner confirms each statement.

## 1. Timeline

- Submission period starts 2026-10-30. The first commit in this repository is
  `c426a64` on 2026-11-11 23:13 (local time), inside the period.
- The viewer commit `610e383` (2026-11-11 23:19) and the backend files first
  committed in `257f7d8` existed before the Kiro commits. Git does not record
  which tool wrote them (see section 3).

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
- **Codex or Claude (unrecorded in git)**: files that existed uncommitted before the Kiro commits and were
  first committed by `257f7d8` or by Claude's import commit `10298ce`. Git
  cannot tell Codex from Claude here. **Owner: replace this label with the
  right name per file group before submission.**
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

## 6. Per-file table

Status: `legacy` = outside the entry. WeatherPath: result of the reuse audit.
Origin chain: oldest first.

| File | Status | WeatherPath | Origin chain |
|---|---|---|---|
| `.env.example` | active | - | Codex or Claude (unrecorded in git) -> Claude |
| `.github/workflows/route-demo-pages.yml` | legacy | - | Codex |
| `.gitignore` | active | - | Kiro |
| `.kiro/hooks/session-start-status.json` | active | - | Kiro |
| `.kiro/hooks/task-progress-tracker.json` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/backend-first-plan.md` | active | - | Codex or Claude (unrecorded in git) |
| `.kiro/specs/aeroicing-watch/design.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/global-satellite-design.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/implementation-scope.md` | active | - | Kiro -> Codex or Claude (unrecorded in git) |
| `.kiro/specs/aeroicing-watch/requirements.md` | active | - | Kiro |
| `.kiro/specs/aeroicing-watch/tasks.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/design.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/requirements.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/submission-checklist.md` | active | - | Kiro |
| `.kiro/specs/cloud-dive/tasks.md` | active | - | Kiro |
| `.kiro/steering/project.md` | active | - | Kiro |
| `LICENSE` | active | - | unrecorded (initial or viewer commit) |
| `README.md` | active | - | unrecorded (initial or viewer commit) -> Kiro -> Claude -> Codex |
| `airports.json` | active | - | Kiro -> Kiro draft, committed by Claude |
| `docs/AeroIcing_Watch_About_the_Project.md` | active | - | unrecorded (initial or viewer commit) -> Kiro |
| `docs/AeroIcing_Watch_Submission_Package.md` | active | - | unrecorded (initial or viewer commit) -> Kiro -> Codex |
| `docs/Flight_Metadata_Lookup.md` | active | - | Codex or Claude (unrecorded in git) |
| `docs/Global_Satellite_Status.md` | active | - | Claude |
| `docs/IFS_Route_Evaluation.md` | active | - | Codex or Claude (unrecorded in git) |
| `docs/WeatherPath_Port_Inventory.md` | active | - | Codex or Claude (unrecorded in git) |
| `docs/WeatherPath_Reuse_Audit.md` | active | - | Kiro |
| `frontend/app.js` | active | none found | Kiro -> Claude |
| `frontend/index.html` | active | none found | Kiro -> Claude -> Codex |
| `frontend/vendor/.gitkeep` | active | - | Codex or Claude (unrecorded in git) |
| `main.py` | active | none found | Codex or Claude (unrecorded in git), then Kiro edits |
| `requirements.txt` | active | - | Codex or Claude (unrecorded in git) -> Claude |
| `src/__init__.py` | active | none found | Codex or Claude (unrecorded in git) |
| `src/analysis/__init__.py` | active | none found | Codex or Claude (unrecorded in git) |
| `src/analysis/aircraft_performance.py` | legacy | none found | Codex or Claude (unrecorded in git) |
| `src/analysis/cloud_base.py` | active (night path legacy) | copied | Codex or Claude (unrecorded in git) -> Claude |
| `src/analysis/icing_profile.py` | active | adapted | Codex or Claude (unrecorded in git), then Kiro edits -> Kiro draft, committed by Claude -> Claude |
| `src/analysis/route_sampler.py` | active | none found | Codex or Claude (unrecorded in git) |
| `src/analysis/route_weather.py` | legacy | none found | Codex or Claude (unrecorded in git) |
| `src/analysis/satellite_router.py` | active | none found | Kiro draft, committed by Claude -> Claude |
| `src/api/__init__.py` | active | none found | Codex or Claude (unrecorded in git) |
| `src/api/icing.py` | active | none found | Codex or Claude (unrecorded in git), then Kiro edits -> Claude |
| `src/api/route_review.py` | legacy | none found | Codex or Claude (unrecorded in git) |
| `src/integration/__init__.py` | active | none found | Codex or Claude (unrecorded in git) |
| `src/integration/flight_lookup.py` | legacy | none found | Codex or Claude (unrecorded in git) |
| `src/integration/geogrid.py` | active | none found | Claude |
| `src/integration/gk2a_cloud.py` | legacy | cache-format dependency | Codex or Claude (unrecorded in git) -> Claude |
| `src/integration/goes_cloud.py` | active | none found | Kiro draft, committed by Claude -> Claude |
| `src/integration/himawari_cloud.py` | legacy | none found | Claude |
| `src/integration/ifs_bbox.py` | active | none found | Claude |
| `src/integration/ifs_grid.py` | active | none found | Codex or Claude (unrecorded in git) -> Claude |
| `src/integration/meteosat_cloud.py` | legacy | none found | Kiro draft, committed by Claude -> Claude |
| `static/route-demo/app.js` | legacy | none found | Codex |
| `static/route-demo/index.html` | legacy | none found | Codex |
| `static/route-demo/scenario.json` | legacy | - | Codex |
| `static/route-demo/styles.css` | legacy | none found | Codex |
| `static/sample.js` | active | none found | Codex or Claude (unrecorded in git) |
| `static/styles.css` | active | none found | Codex or Claude (unrecorded in git) |
| `static/viewer-standalone.html` | active | none found | Codex or Claude (unrecorded in git) |
| `static/viewer.js` | active | none found | Codex or Claude (unrecorded in git), then Kiro edits |
| `tests/test_flight_lookup.py` | legacy | none found | Codex or Claude (unrecorded in git), committed by Claude |
| `tests/test_global_satellite.py` | active | none found | Claude |
| `tests/test_icing_api.py` | active | none found | Codex or Claude (unrecorded in git), committed by Claude |
| `tests/test_ifs_route.py` | legacy | none found | Codex or Claude (unrecorded in git), committed by Claude |
| `tests/test_pacific_coverage.py` | active | none found | Claude |
| `tools/build_airports.py` | active | none found | Kiro draft, committed by Claude |
| `tools/collect_goes.py` | active | none found | Claude |
| `tools/collect_himawari.py` | legacy | none found | Claude |
| `tools/collect_ifs.py` | active | adapted | Codex or Claude (unrecorded in git), committed by Claude -> Claude |
| `tools/export_route_demo.py` | legacy | none found | Codex |
| `tools/import_weatherpath_ctps.py` | legacy | runtime dependency | Codex or Claude (unrecorded in git), committed by Claude |
| `tools/validate_ifs_icing.py` | legacy | none found | Codex or Claude (unrecorded in git), committed by Claude |
