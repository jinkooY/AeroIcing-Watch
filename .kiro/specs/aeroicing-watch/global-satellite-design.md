# Global Satellite Integration Design

## Goal

Extend AeroIcing Watch from GK-2A KO domain (lat 32–44.5°N, lon 122–134.5°E)
to full global coverage by integrating GOES-16/18 and Meteosat-9/12 alongside
the existing GK-2A pipeline.

---

## 1. Coverage Map

```
Longitude coverage (approximate):
  GOES-16  (75.2°W) : 155°W – 15°W   Americas + E Pacific
  GOES-18 (137.0°W) : 165°E – 95°W   W Pacific + Americas west
  Meteosat-9  (9.5°E): 60°W – 80°E   Europe, Africa, Indian Ocean
  Meteosat-12  (0°E) : 60°W – 80°E   Europe, Africa (operational)
  GK-2A  (128.2°E)  : 60°E  – 160°E  East Asia (current)

Polar gap: satellites do not provide useful L2 above ~70°N/S.
Best-overlap at seams (choose by distance to sub-satellite point):
  GK-2A ↔ Meteosat  : ~80–90°E
  GK-2A ↔ GOES-18   : ~160°E / 160°W
  GOES-16 ↔ Meteosat: ~60°W / 15°W
```

---

## 2. Data Sources

### GOES-16 / GOES-18 — NOAA (Free, AWS S3)

**Source:** `s3://noaa-goes16/` and `s3://noaa-goes18/`  
**Access:** Anonymous public, no key required  
**Latency:** ~5 min after scan completion  
**Update:** Every 10 min (Full Disk)

Relevant L2 products:

| Product code | Description | Key fields |
|---|---|---|
| `ABI-L2-ACHA` | Cloud Top Height Algorithm | `HT` (m), `TEMP` (K), `PHASE` |
| `ABI-L2-ACM` | Clear Sky Mask | cloud/clear flag |
| `ABI-L2-ACTP` | Cloud Top Phase | supercooled liquid flag |

Path pattern:
```
s3://noaa-goes16/ABI-L2-ACHAF/{YYYY}/{DDD}/{HH}/
  OR_ABI-L2-ACHAF-M6_G16_sYYYYDDDHHMMSS_...nc
```

PHASE codes in ACTP/ACHA:
- 0 = clear
- 1 = liquid water
- 2 = supercooled liquid  ← direct supercooled flag
- 3 = mixed
- 4 = ice
- 5 = unknown

Python access via `s3fs` (anonymous):
```python
import s3fs
fs = s3fs.S3FileSystem(anon=True)
files = fs.ls("noaa-goes16/ABI-L2-ACHAF/2026/315/03/")
```

### Meteosat-9/12 — EUMETSAT Data Store

**Source:** `https://api.eumetsat.int/data/browse/`  
**Access:** Free account required at eumetsat.int, OAuth2 client credentials  
**Product:** `EO:EUM:DAT:MSG:CTTH` (Cloud Top Temperature and Height)  
**Update:** Every 15 min (Rapid Scan: 5 min over Europe)

Key fields:
- `cloud_top_height` (m)
- `cloud_top_temperature` (K)
- `cloud_phase` (clear/liquid/ice/uncertain)

Existing pattern in hackerton_2026 `src/integration/eumetsat_iasi.py` can be
adapted for CTTH product download.

### GK-2A — KMA APIHub (existing)

Already implemented. Keep as-is for the KO domain.

---

## 3. Unified Field Schema

All three pipelines must produce the same projected npz field format used by
`src/integration/gk2a_cloud.py` to allow `icing_profile.py` to work
source-agnostic.

Shared field names (dtype float32, fill = NaN):

| Field | Description | Unit |
|---|---|---|
| `cth_ft` | Cloud top height | ft MSL |
| `ctt_k` | Cloud top temperature | K |
| `phase` | Cloud phase code (1=liquid, 2=ice, 6=unknown) | — |
| `supercooled` | Supercooled flag (1=yes, 0=no) | — |
| `emis11` | 11 µm emissivity (optional, night base est.) | 0–1 |

GOES phase mapping to shared schema:
```
GOES 0 (clear)        → NaN (no cloud)
GOES 1 (liquid)       → phase=1, supercooled=0
GOES 2 (supercooled)  → phase=1, supercooled=1  ← key icing signal
GOES 3 (mixed)        → phase=1, supercooled=1
GOES 4 (ice)          → phase=2, supercooled=0
GOES 5 (unknown)      → phase=6
```

---

## 4. Source Selection Logic

For each sample point (lat, lon), select the satellite whose projected cache
is freshest and whose domain covers the point:

```python
def select_source(lat: float, lon: float, now: datetime) -> str:
    """Return 'gk2a' | 'goes16' | 'goes18' | 'meteosat' | None."""
    candidates = []
    # GK-2A: KO domain
    if 32 <= lat <= 44.5 and 122 <= lon <= 134.5:
        candidates.append(("gk2a", _gk2a_age(now)))
    # GOES-18: 160E–95W (lon >= 160 or lon <= -95)
    if lon >= 160 or lon <= -95:
        candidates.append(("goes18", _goes18_age(now)))
    # GOES-16: 155W–15W (-155 <= lon <= -15)
    if -155 <= lon <= -15:
        candidates.append(("goes16", _goes16_age(now)))
    # Meteosat: 60W–80E (-60 <= lon <= 80)
    if -60 <= lon <= 80:
        candidates.append(("meteosat", _meteosat_age(now)))
    if not candidates:
        return None
    # Prefer freshest; break ties by proximity to sub-satellite point
    return min(candidates, key=lambda c: c[1])[0]
```

---

## 5. New Module Structure

```
src/
  integration/
    gk2a_cloud.py          # existing — KO domain
    goes_cloud.py          # NEW — GOES-16/18 ABI L2 ACHA/ACTP
    meteosat_cloud.py      # NEW — Meteosat CTTH via EUMETSAT Data Store
  analysis/
    satellite_router.py    # NEW — source selection + unified field loader
    icing_profile.py       # existing — works unchanged via satellite_router
```

### `src/integration/goes_cloud.py` responsibilities
- Anonymous S3 download of GOES-16/18 ABI-L2-ACHA Full Disk NetCDF4
- Project to a standard lat/lon grid (pyproj GOES-R ABI fixed grid → WGS84)
- Map ACTP phase codes to shared schema
- Save as npz with same field names as gk2a_cloud

### `src/integration/meteosat_cloud.py` responsibilities
- OAuth2 token management for EUMETSAT Data Store
- Download MSG CTTH HDF5/NetCDF4
- Project to lat/lon grid
- Map Meteosat phase codes to shared schema
- Save as npz

### `src/analysis/satellite_router.py` responsibilities
- `load_field(lat, lon, dt)` — returns unified field dict from best source
- `available_sources(dt)` — returns list of sources with latest frame times
- Called by `icing_profile.py` instead of directly importing `gk2a_cloud`

---

## 6. Airport Route Data

For global route planning, replace the static `airports.json` with a richer
source. Options by feasibility:

### Option A — OurAirports (recommended for hackathon)
- URL: `https://ourairports.com/data/airports.csv`
- 72,000+ airports worldwide, free, CC0 license
- Fields: ident (ICAO), type, name, lat_deg, lon_deg, elevation_ft, iata_code
- Download once at startup or bundle a snapshot
- Filter to `type IN ('large_airport', 'medium_airport')`

### Option B — OpenAIP API (for airways/waypoints)
- URL: `https://api.openaip.net/`
- Provides: airports, navaids, airspaces, reporting points
- Free tier: 1,000 requests/day
- Use for waypoint lookup beyond airport lat/lon

### Option C — FAA NASR (US-only, full airways)
- URL: `https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/`
- 28-day cycles, free, public domain
- Covers: airways, fixes, navaids, METARs
- Requires NASR text format parser

### Option D — OpenSky Network (actual flight paths)
- URL: `https://opensky-network.org/api`
- Returns actual ADS-B tracks for recent flights
- Use as a "pre-fill route from flight number" feature

### Recommendation for this project
1. Replace `airports.json` with OurAirports snapshot (large + medium airports)
2. Add OpenAIP waypoints for en-route fixes
3. Integrate OpenSky for "look up flight number → auto-fill route" via
   the existing AeroDataBox adapter

---

## 7. Implementation Phases (Global Extension)

| Phase | Scope | Estimate |
|---|---|---|
| G1 | OurAirports CSV → replace airports.json (5,000+ airports) | 2 hrs |
| G2 | GOES-16/18 ABI L2 ACHA downloader + projection | 8 hrs |
| G3 | satellite_router.py + source selection logic | 3 hrs |
| G4 | Meteosat CTTH via EUMETSAT Data Store | 6 hrs |
| G5 | Frontend: show satellite source label per sample | 2 hrs |
| G6 | Polar gap notice (lat > 70°N/S) | 1 hr |

**Total estimate: ~22 hrs**

G1 + G2 + G3 alone cover Americas + East Asia (GOES + GK-2A) with no
authentication overhead — fastest path to global coverage.

---

## 8. Constraints and Limitations

- **GOES projection:** ABI uses a fixed-grid geostationary projection
  (GOES-R series, CGMS Doc. 416). pyproj handles this natively.
- **Meteosat auth:** EUMETSAT requires account registration. The existing
  `eumetsat_iasi.py` OAuth2 pattern in hackerton_2026 is directly reusable.
- **Polar regions:** No geostationary satellite covers above ~70°N/S.
  Return `retrievalState: "outside_domain"` and suggest checking MODIS/VIIRS
  polar-orbiting products (not in scope).
- **Seam zones:** ±10° around sub-satellite longitude boundaries may have
  worse parallax and limb-effect quality. Flag samples with `domainEdge: true`.
- **Cloud base estimation:** Noh et al. (2017) was derived from East Asian
  cases. It applies to GOES/Meteosat data as a provisional estimate; label
  clearly in the UI.
