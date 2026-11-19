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

The ECMWF and NOAA attribution lines above were confirmed by the owner on 2026-11-19 (checklist C4). The
game note and source line in the game screens name both sources.

## Iowa Environmental Mesonet PIREP archive

| Item | Value |
|---|---|
| Used for | Screening candidate case days and routes on 2026-11-13 (counts of icing PIREPs near each route, requirements 5.4 and 5.5). Proposed and run by Kiro (owner statement, 2026-11-19; the commit `12140c4` does not record the tool), not asked for by the owner. No PIREP data is in the case files or shown in the game |
| Source | Iowa Environmental Mesonet (IEM), Iowa State University, PIREP archive of NWS reports |
| Terms | "The materials found on this website are in the public domain and may be used freely by anyone for any lawful purpose. Attributing the Iowa Environmental Mesonet of Iowa State University would be appreciated." (https://mesonet.agron.iastate.edu/disclaimer.php, read 2026-11-19). Attribution: Iowa Environmental Mesonet, Iowa State University. PIREPs are reports, used only to choose cases, never as validation (guardrail rule 2) |

## Tools and services used to test and to make the video (not shipped)

None of these is part of the published game or loaded by it. They were used on the author's machine or as
online services while building, testing and recording.

| Item | Use | Terms |
|---|---|---|
| Blender 4.5.9 LTS | Renders the cloud shots of the submission video from the GOES case data (`tools/video/blender/`) | GPL-3.0 (the program); the rendered images are the author's work |
| FFmpeg 9.0.2 (gyan.dev full build) | Records the takes and encodes the video (`tools/video/`) | GPL build, used as a separate program |
| Google Gemini text-to-speech (paid API) | English narration of the final video only (`tools/video/make_narration.py`) | Used under the owner's paid Gemini API account. Gemini API Additional Terms (https://aistudio.google.com/docs/terms, read 2026-11-19), Use of Generated Content: "Google won't claim ownership over that content"; the user is responsible for its use. The video description names the voice as synthetic |
| Noto Sans (Google) | Captions, cards, diagrams and route graphics of the video | SIL Open Font License 1.1 (free; https://openfontlicense.org); used from the installed font in `tools/video/make_final.py`, `make_route_graphics.py`, `make_animatic.py` and `docs/video/assets/diagram.html`, not redistributed here. The game itself ships no font: it uses the viewer's system font |
| Pillow (MIT-CMU), Hypothesis (MPL-2.0) | Map images of the case files (`cases/*.png`, build time), video cards and stills; property-based tests | Python libraries, installed from PyPI, not modified |
| Playwright MCP 0.0.85 (Apache-2.0), Microsoft Edge | Headless and phone-size layout checks | Tools only |
| BrowserStack (service) | Real-device check on a Samsung Galaxy S25 Ultra | Online service, used under the author's account |
