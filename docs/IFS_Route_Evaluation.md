# Archived IFS route evaluation

## Setup and cache contract

Activate the WeatherPath Python environment or install the AeroIcing Watch requirements. The collector additionally needs the ecCodes Python bindings and native library. On Windows Conda, activate the environment so its Library/bin is on PATH.

```powershell
python tools/collect_ifs.py --run 2026111112 --steps 12 15 18 --product 0p25 --source google
python -m uvicorn main:app --host 127.0.0.1 --port 8080
```

The command uses the ECMWF public rolling archive. Use a currently published run for new downloads. Published bundles stay usable locally after the source expires. The default cache is `data/ifs`, overridden with `IFS_CACHE_ROOT` for the API and `--root` for the collector.

The collector reads selected byte ranges from public forecast indexes, following the WeatherPath 0.25° profile parameter list and the WeatherPath high-resolution archive's GRIB validation and grid-cropping approach. It records source URLs, mirror, product, units, pressure levels, initialization, valid times, each message receipt and SHA-256, and the time the whole bundle became available. It publishes a new immutable bundle atomically. The Tokyo-inclusive crop is 30–46°N and 118–143°E. The standard request uses geopotential height, temperature, relative humidity and eastward/northward wind at 850, 500, 300 and 250 hPa. The 0.1° path selects a separate pressure-level product with its own receipt time. Real 0.1° acquisition and latency have yet to be tested. [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data)

WeatherPath `status` and `overlay-info` are published-cache readiness and manifest references. Its `timeseries` route serves a recent point meteogram. Route evaluation needs original fields from a specified cycle and valid times across the full path, so this API reads its separate regional cache and follows the WeatherPath source without importing it at runtime.

## API

- `GET /api/route-review/ifs/status` lists readable bundles and provenance.
- `POST /api/route-review/evaluate` evaluates one supplied route in level cruise. Send `waypoints` as latitude/longitude pairs, `decision_at` and `departure_at` as UTC, and optionally `initialized_at`, `product`, `flight_alt_ft`, `tas_kt`, and `mass_kg`. The OpenAPI page at `/docs` contains the schema.
- The API chooses the latest eligible initialization of the requested product among bundles received by decision time, or the requested initialization if provided. A request with no eligible bundle returns HTTP 404.
- The engine interpolates linearly in latitude, longitude, valid time and log pressure. Flight altitude is pressure altitude, converted to pressure using the standard atmosphere. The crosswind component reduces available along-track airspeed before the along-track wind is applied. Segment duration uses the wind at an iterated midpoint ETA. OpenAP 2.4 fuel flow is integrated across segment durations as mass decreases, using IFS temperature departure from ISA. Results cover level cruise only. [OpenAP fuel flow](https://openap.dev/fuel_emission.html)
- The response includes endpoint weather, segment weather, wind direction from true north, wind and groundspeed in knots, ETA, distance, estimated fuel, and input assumptions. Time, altitude and horizontal out-of-coverage states are explicit. If wind or temperature prevents further ETA integration, the evaluation stops at the affected segment and withholds the route total.
- The CTPS section is separate observational context. Locally archived CTPS without known receipt time is marked `availability_unverified` and is excluded from forecast calculation. The CTPS routes and existing viewer JSON remain available independently.

### Aircraft and engine selection

`GET /api/route-review/aircraft` lists aircraft, engine options, default engines, and model operating-empty and maximum takeoff masses in kg. It lists only aircraft and engine combinations that can initialize with the installed OpenAP data. It uses native type codes without synonym substitution. The listed masses are model limits and the engine options describe available simulations.

To use a different combination, add the following fields to an existing evaluation request with a locally available IFS bundle and valid decision and departure times.

```json
{
  "aircraft": "B789",
  "engine": "GENX-1B74",
  "mass_kg": 180000
}
```

Existing requests still default to A320/CFM56-5B4 at 62,000 kg. An explicit aircraft without an engine uses its OpenAP default. Supply mass explicitly for aircraft other than A320. Incompatible engines and out-of-model masses return HTTP 422. The response identifies the aircraft, engine, engine source, mass source and installed OpenAP version. The evaluation accepts manual inputs independently of [flight lookup](Flight_Metadata_Lookup.md).

## Real archived run check

| Item | Result |
| --- | --- |
| IFS initialization | 2026-11-11 12:00 UTC |
| Local bundle available | 2026-11-12 00:38:54.734581 UTC |
| Forecast validity | 2026-11-12 00:00, 03:00 and 06:00 UTC |
| Product and source | ECMWF IFS 0.25°, Google public mirror, 60 selected GRIB messages, 26,389,139 bytes |
| Illustrative case | RKSI–RJTT great-circle and a path via 34.8°N, 133.0°E. Both use assumed A320 CFM56-5B4, 62,000 kg, FL300 and TAS 450 kt at 01:00 UTC |
| Great-circle result | 1,212.6 km, 49 segments, 77.0 min, estimated cruise fuel 3,553.4 kg |
| Illustrative waypoint result | 1,283.0 km, 52 segments, 80.0 min, estimated cruise fuel 3,704.2 kg |
| Great-circle endpoint conditions | RKSI 271° true at 92.9 kt, −40.3 °C. RJTT 280° true at 28.8 kt, −46.0 °C. Segment groundspeed 479.1–541.9 kt |

Both endpoints had forecast data. The first segment was checked using a separate OpenAP call and a distance/groundspeed calculation, and the fuel total against the sum of segments. These are illustrative routes with assumed aircraft inputs. They do not establish airway clearance, gate-to-gate fuel, fuel savings, or performance-model accuracy. Requests and responses are in the local ignored `data/ifs-validation` directory.

## Icing cue and validation

`ifs-temperature-rh-v1` screens −25 to 0 °C with at least 85% relative humidity at the requested pressure altitude. These are provisional research thresholds. The result describes a possible environment or a criterion that was not met. A missing temperature or humidity leaves the segment unassessed. The API keeps this signal separate from CTPS cloud-top supercooling and leaves icing probability, severity, and automatic exclusion unavailable. The public IFS screen uses no column-integrated liquid water, model-level cloud liquid water, or WAFS icing. These can be added as separate sources when access and applicability are confirmed.

Use saved route responses from a fixed rule and archived IFS snapshots. Keep calibration and independent validation cases separate. Normalize aircraft observations or explicit encounter reports to this CSV contract.

```csv
id,observed_at,lat,lon,alt_ft,label
report-001,2026-11-12T01:35:00Z,36.0,134.0,30000,icing
```

Use pressure altitude in feet and UTC with an offset. Select `icing` or `no_icing` only from an explicit positive or negative observation. Leave unreported conditions `unknown`. The row above illustrates format only.

```powershell
python tools/validate_ifs_icing.py data/ifs-validation/rksi-rjtt-direct.json --reports path/to/explicit-labels.csv --label-kind independent
```

The matcher uses one nearest eligible point per explicit report within specified spatial, temporal and vertical tolerances. Default tolerances are 25 km, 15 minutes and 1,000 ft. Report the number of matched and explicit reports, assessed and planned segments, coverage, detection rate, false alarm ratio and false positive rate. Missing denominators produce null. Comparison with WAFS or GK-2A ICING uses `--label-kind diagnostic` and is reported as agreement. Software test labels use `synthetic`.

The great-circle case provided inputs for all 49 segments and met the cue threshold on zero. The local archive had no concurrent CTPS evidence for this run and no independent aircraft icing labels. Icing accuracy remains unevaluated. Data coverage and forecast agreement are separate from accuracy.
