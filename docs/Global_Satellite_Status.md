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
