# Third-party notices

Code and data vendored into this repository. Each entry is pinned to an exact
version and checked against its official source. Nothing is loaded from a CDN.

## three.js

| Field | Value |
|---|---|
| Used for | 3D cockpit cruise view (`static/cloud-dive/cockpit3d.js`) |
| Version | 0.160.1 (exact; npm `three@0.160.1`) |
| Licence | MIT, Copyright 2010-2023 three.js authors |
| Source | https://github.com/mrdoob/three.js (npm package `three`) |
| Vendored file | `static/cloud-dive/vendor/three/three.module.min.js` (taken unchanged from `build/` of the package) |
| File SHA-256 | `3e690ac7d180b0aadf0891bea39eec643e29e2d3e75c99b18689518665f69ba6` |
| Licence file | `static/cloud-dive/vendor/three/LICENSE` (SHA-256 `852e0e8699169bf9f6fdc6bda3e682d078dcbc738b5d33e74df594721bff271d`) |
| Package tarball SHA-1 | `61fe2907312e8604b1f64187f58e047503847413` (matches the npm registry `dist.shasum`) |
| Package integrity | `sha512-Bgl2wPJypDOZ1stAxwfWAcJ0WQf7QzlptsxkjYiURPz+n5k4RBDLsq+6f9Y75TYxn6aHLcWz+JNmwTOXWrQTBQ==` |

The file is a single self-contained ES module with no imports, so it works with
no build step. To verify: `Get-FileHash static/cloud-dive/vendor/three/three.module.min.js -Algorithm SHA256`.

Release 0.160.1 is the last line that ships a pre-minified single-file module;
later releases split into `three.module.js` and `three.core.js` without a
minified build.

## OurAirports airport data (`airports.json`)

| Field | Value |
|---|---|
| Used for | Airport elevations (`elev_ft`) written to the case files as `airports.{from,to}.elevFt` by `tools/export_departure.py`; also airport positions for the dispatcher view |
| Source | OurAirports open data, https://ourairports.com/data/ (file `airports.csv`) |
| Built by | `tools/build_airports.py`, which keeps `large_airport` and `medium_airport` rows with a 4-letter `ident` and writes `airports.json` at the repository root |
| Licence | Public domain. The OurAirports data page says all data is released to the Public Domain, with no guarantee of accuracy or fitness for use (checked 2026-11-13 through a web search of that page; the page itself could not be fetched because its TLS certificate had expired, and `tools/build_airports.py` turns certificate checks off for the same reason) |
| Attribution | Not required by the licence; given here as a courtesy |
| Snapshot | `airports.json` is committed (first in commit `10298ce`); the download date is not recorded in the file, so the elevations are those of that snapshot |
| Values used | KDEN 5431 ft, KLAX 125 ft, KBUF 728 ft, KPWM 76 ft, KJFK 13 ft, KBNA 599 ft |

Elevations are used only to price the illustrative departure climb constant (`params.departureClimbUsd`,
formula in `params.departureClimbNote`). They are not used for any icing evidence.

## Data and methods used by the game

| Item | Use | Terms |
|---|---|---|
| ECMWF Open Data IFS | Forecast background in the case files | CC BY 4.0, source ECMWF |
| NOAA GOES-R ABI Level-2 (ACTPC, ACHAC, CODC, CPSC) and CMI band 13 | Cloud evidence and the map image in the case files | Public data on AWS (NOAA Open Data) |
| Natural Earth 1:50m | State lines and coastline in `static/cloud-dive/cases/basemap.json` | Public domain |
| Noh et al. (2017), JTECH 34, 585-598 | Cloud base estimate (`src/analysis/cloud_base.py`) | Published method, cited |
| OpenAP (LGPL-3.0) | Build-time cost tables for the cost model; not shipped to the browser | Used as a library, not modified |
| CIRA aviation cross-section product | Referenced prior work only; no code or images used | Not applicable |

Owner to confirm the exact wording of the ECMWF and NOAA attribution lines before submission
(checklist C4). The game note and source line in the game screens already name both sources.
