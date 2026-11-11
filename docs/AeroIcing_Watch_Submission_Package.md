# AeroIcing Watch — Devpost Submission Notes

## Elevator Pitch

AeroIcing Watch helps airline dispatchers explore cloud heights, phase, and potential icing cues along a selected flight segment in a vertical profile.

## Sample Image Caption

Satellite-derived cloud tops, estimated cloud bases, and cloud phase along a selected 455 km transect.

The illustrative image depicts a different case from the viewer's bundled synthetic example. Confirm the image's redistribution rights before attaching it publicly.

## Key Features

- Interactive A–B cloud cross-section with a keyboard-accessible sample selector.
- Supplied cloud tops, estimated bases, phase, and optional supercooling cues.
- Explicit coverage gaps, source time, and simulated-data labeling.
- Local JSON import.

## Built With

HTML, CSS, JavaScript, Canvas API.

## Demo Video

| Time | Footage |
|---|---|
| 0:00–0:20 | Introduce the airline dispatcher and the need to view cloud height along a segment. |
| 0:20–1:05 | Open the app and inspect the labeled simulated transect. |
| 1:05–1:45 | Move through a flagged sample, a missing base, and a coverage gap. |
| 1:45–2:15 | Import a sample JSON profile and show its source metadata. |
| 2:15–2:45 | Explain the plans for live weather data, waypoint alignment, and validation. |

## Submission Checks

Confirm the public demo URL, video, actual Kiro development evidence, and competition eligibility before submission.

## About the Project

### Inspiration

For an airline dispatcher reviewing possible icing, a satellite map answers where clouds are. The next question is where those clouds sit vertically along the proposed segment. AeroIcing Watch explores how a cross-section could make cloud height, phase, and uncertainty easier to interpret during a dispatch review.

### What It Does

AeroIcing Watch is a standalone prototype for reviewing cloud profiles along an A–B segment. The viewer plots distance against altitude, identifies estimated cloud bases, and shows phase and optional supercooling cues. Users can click the chart or use the keyboard-accessible sample selector to inspect individual values. It opens with a labeled simulated profile and can also read a profile JSON file locally in the browser.

### How We Built It

The app uses HTML, CSS, JavaScript, and Canvas. A small JSON contract records source, UTC observation time, distance, altitude above mean sea level, cloud phase, and optional supercooling flags. The viewer validates the file before displaying it. The app can run from local files and processes imported profiles in the browser. The supplied example is synthetic. Live collection and weather-data conversion are future integrations.

### Challenges We Faced

A missing cloud base and a missing observation need different visual treatments. A sample with a known cloud top and an unknown base is drawn as a top marker. A sample with no top is drawn as a coverage gap. Simulated and observation profiles are identified in the interface, and the supercooling indicator preserves a separate unavailable state.

### Accomplishments

We built a self-contained cross-section viewer, a labeled sample dataset, and a documented import format. The chart and the readout preserve the distinction between the supplied cloud top, the estimated base, and any accompanying phase or supercooling cue.

### What We Learned

A supercooling cue near cloud top can point to an area worth reviewing. Estimating potential exposure at a specific flight level also requires planned time and altitude, additional weather evidence, and independent validation.

### What's Next

We plan to add geostationary satellite and numerical forecast inputs, import waypoint times and planned altitudes, and evaluate the resulting cues against pilot reports and authoritative icing products. The intended benefits are earlier recognition of areas that warrant review, better-informed routing and altitude comparisons, and less time spent on weather-related dispatch reviews.
