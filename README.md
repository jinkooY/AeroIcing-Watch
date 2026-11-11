# AeroIcing Watch

AeroIcing Watch is a prototype for commercial airline dispatchers to inspect cloud structure and potential icing cues along a flight segment.

## Run the viewer

Open `index.html` in a modern browser. The included 180 km transect uses simulated data. Click the chart or use the sample selector to inspect cloud top, estimated cloud base, phase, and supercooling cues. Select **Open profile JSON** to inspect your own profile locally. The viewer reads the file in your browser.

The chart draws the uppermost supplied cloud layer. A missing top is shown as a coverage gap. A known top with an unavailable base is shown as a top marker. The viewer supports review of supplied evidence. Flight-level exposure, live satellite ingestion, and flight-plan integration are future work.

## Profile format

```json
{
  "title": "Example A–B profile",
  "dataKind": "simulated",
  "source": "Illustrative data",
  "observedAt": null,
  "samples": [
    {"distanceKm": 0, "topFt": 16000, "baseFt": 11500, "phase": "liquid", "supercooled": true},
    {"distanceKm": 30, "topFt": 18000, "baseFt": null, "phase": "ice", "supercooled": null},
    {"distanceKm": 60, "topFt": null, "baseFt": null, "phase": null, "supercooled": null}
  ]
}
```

- Use `simulated` for examples and `observation` for observation profiles. Observations require an ISO 8601 UTC timestamp such as `2026-11-11T00:00:00Z`.
- Supply 2 to 2,000 samples in strictly increasing distance order, starting at 0 km. Heights use feet above mean sea level.
- Phase accepts `liquid`, `ice`, `unknown`, or `null`. Supercooling accepts `true`, `false`, or `null` for unavailable. Use `null` for cloud fields when the top is unavailable.

[Project story](docs/AeroIcing_Watch_About_the_Project.md) · [Demo and submission notes](docs/AeroIcing_Watch_Submission_Package.md)
