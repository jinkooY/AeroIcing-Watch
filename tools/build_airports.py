"""Download OurAirports CSV and write airports.json at the repo root."""
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "airports.json"
URL = "https://ourairports.com/data/airports.csv"
KEEP_TYPES = {"large_airport", "medium_airport"}

print(f"Downloading {URL} ...")
try:
    import requests as _req
    text = _req.get(URL, timeout=30, verify=False).text
    import urllib3; urllib3.disable_warnings()
except ImportError:
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    import urllib.request as _ur
    with _ur.urlopen(URL, timeout=30, context=ctx) as response:
        text = response.read().decode("utf-8")

rows = list(csv.DictReader(io.StringIO(text)))
print(f"Total rows: {len(rows)}")

result = {}
skipped = 0
for row in rows:
    if row.get("type") not in KEEP_TYPES:
        skipped += 1
        continue
    icao = row.get("ident", "").strip().upper()
    if not icao or len(icao) != 4:
        skipped += 1
        continue
    try:
        lat = float(row["latitude_deg"])
        lon = float(row["longitude_deg"])
    except (ValueError, TypeError):
        skipped += 1
        continue
    elev_raw = row.get("elevation_ft", "").strip()
    try:
        elev = int(float(elev_raw)) if elev_raw else None
    except (ValueError, TypeError):
        elev = None
    result[icao] = {
        "name": row.get("name", "").strip(),
        "city": (row.get("municipality") or "").strip() or None,
        "country": row.get("iso_country", "").strip(),
        "iata": row.get("iata_code", "").strip() or None,
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "elev_ft": elev,
        "type": row["type"],
    }

print(f"Kept: {len(result)}  Skipped: {skipped}")

spot = ["RKSI", "RJTT", "EGLL", "KJFK", "ZBAA", "VHHH", "WSSS", "YSSY", "FAOR"]
for code in spot:
    a = result.get(code)
    if a:
        print(f"  {code}: {a['name']} ({a['country']}) lat={a['lat']} lon={a['lon']}")
    else:
        print(f"  {code}: MISSING")

OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"\nWritten {len(result)} airports to {OUT}")
