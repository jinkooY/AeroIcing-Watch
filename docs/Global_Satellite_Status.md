# Global Satellite Extension — Status (G1–G6)

| Phase | State | Evidence |
|---|---|---|
| G1 OurAirports (4,965 airports) | Done | `airports.json` (UTF-8), `tools/build_airports.py`; loaded by `/airports.json` |
| G2 GOES ACHA/ACHT/ACTP | **Verified with real data** (GOES-18, GOES-19, 2026-11-12) | `tools/collect_goes.py G18 G19`; ACHAF `HT`, ACHTF `TEMP`, ACTPF `Phase` read from anonymous S3 |
| G3 Router | Done, unit-tested | `tests/test_global_satellite.py` |
| G4 Meteosat CTTH | **Unverified** | Needs EUMETSAT credentials; without them it reports "source unavailable". API endpoints/collection id/variable names are best guesses |
| G5 Frontend source label | Done (`node --check` ok; exercised in the in-app browser) | per-sample Satellite source / Retrieval rows, sources line |
| G6 Polar gap | Done | `retrievalState: "outside_domain"` above 70°N/S, `polarGap`, UI notice |

## Findings from real data
- `noaa-goes16` stops in April 2025; **GOES-19** is GOES-East. `G19` was added; `G16` is archive-only.
- `ABI-L2-ACHAF` has only `HT` (10 km grid, 1086²) — no `PHASE`/`TEMP`. Phase comes from `ABI-L2-ACTPF` (2 km), temperature from `ABI-L2-ACHTF`. The earlier draft's temperature-derived "supercooled" guess was removed.
- The draft wrote linear-latitude rows while the reader used Mercator rows; both now use `src/integration/geogrid.py`.
- Parallax correction was hard-wired to GK-2A's longitude; it now uses the selected source's sub-satellite longitude.
- A missing cloud height is not "clear": GOES frames carry a `clear` flag (ACTP phase 0); everything else is `no_retrieval`.

## Not verified / open
- Meteosat download + decode (no credentials).
- Gap between Meteosat (≤80°E) and GK-2A KO (≥122°E) — no source (Himawari/INSAT not integrated).
- Only nearest-neighbour projection at ~25–30 km grid resolution (500×620 per source); GK-2A optics are not used on mixed routes.

## Pacific gap follow-up (US–Japan routes)

Before: KSFO–RJTT / KLAX–RJAA / KSEA–RJAA had a 26–32 % gap (≈140–165E).

**Himawari-9 (real data, verified 2026-11-12 13:20 UTC).** `noaa-himawari9/AHI-L2-FLDK-Clouds/YYYY/MM/DD/HHMM/` holds `AHI-CHGT` (`CldTopHght` m, `CldTopTemp` K, `Latitude`, `Longitude`), `AHI-CMSK`, `AHI-CPHS` (`CloudPhase`, valid_range 0–5). Files are 5500×5500 (2 km): ~800 MB + ~85 MB for the two we need. Phase codes are not listed in the file metadata; mapping follows the NOAA CCF/ACTP convention and is consistent with the data (mean cloud-top temperature: code1 284 K, code2 264 K, code3 253 K, code4 231 K). `CloudHgtQF` semantics are undocumented and unused. `h5py` is broken in this env (DLL), so partial/remote reads were not possible; whole files are read with netCDF4.

**GK-2A wider area: unverified.** No KMA key in this environment. `GK2A_CLOUD_AREA` (KO default, EA, FD) plus `GK2A_CLOUD_BOUNDS`/`_SHAPE` select the projected cache grid and register it in the router; EA/FD grid values are our planned cache grids, not confirmed APIHub deliveries. Tested with fixtures only.

**API results with real G18 + G19 + H09 frames (alt 35 000 ft, 50 km spacing):**

| Route | G18 | H09 | no source | observed | clear | no_retrieval | domainEdge |
|---|---|---|---|---|---|---|---|
| KSFO–RJTT (167 samples) | 55.1 % | 44.9 % | 0 % | 90.4 % | 6.0 % | 3.6 % | 27.5 % |
| KLAX–RJAA (176) | 58.5 % | 41.5 % | 0 % | 94.3 % | 4.5 % | 1.1 % | 23.9 % |
| KSEA–RJAA (154) | 51.3 % | 48.7 % | 0 % | 89.0 % | 9.1 % | 1.9 % | 50.6 % |

Remaining gap is 0 % of samples; 1–4 % are `no_retrieval` (unassessed), and altitude suggestions are therefore withheld on these routes.

**IFS across the dateline (real ECMWF Open Data, run 2026-11-12 00Z, 0p25).** Route-derived bbox KSEA–RJAA 30.8–59.3N, 135.4–242.7E, steps 12/18/24/30: 36.4 MB of GRIB ranges downloaded, 4.5 MB `.npz`. `POST /api/route-review/evaluate` (B789, 230 t, FL300, 470 kt) completed all segments for KSEA–RJAA (307), KSFO–RJTT (333) and KLAX–RJAA (351) with the longitude wrapping through 180. IFS shows `criterion_not_met` everywhere at FL300 (too cold), so no icing environment was found. ecCodes needed `ecmwflibs` in this env (now in requirements). The route-review CTPS observation block still reads the GK-2A cache only.
