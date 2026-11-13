# Submission drafts — AeroIcing Watch (Kiroween 2026, category Frankenstein)

Deadline: 2026-12-04 14:00 PT (2026-12-05 07:00 KST). Internal target: submit by 2026-12-03 KST.

These are drafts. Statements about the fusion engine, replay, UI and deployment describe the planned submission scope and must be checked against what actually shipped before submitting. Anything not yet true is marked TBD. Do not submit with a TBD left in.

---

## 1. Devpost text description (reduced scope)

### Inspiration

Aircraft icing mostly occurs in supercooled liquid cloud between 0 °C and about −20 °C. At jet cruise levels the air is far colder, so the exposure is mostly in climb and descent and on low-level domestic and short-haul flights. A dispatcher checking those phases before departure has to combine satellite imagery, forecast temperature and the planned altitude profile by hand. We wanted to put those three on one vertical cross-section along the route.

### What it does

AeroIcing Watch draws a vertical cross-section of cloud along a flight route from archived GK-2A geostationary satellite cloud products (cloud-top height, phase and supercooled flag) and ECMWF IFS forecast temperature. [TBD: confirm each item below shipped.]

- It samples any route inside the GK-2A Korea-area domain (32–44.5 °N, 122–134.5 °E) and estimates cloud base along it.
- It builds a climb–cruise–descent flight profile and checks, at each sample, whether the planned altitude lies inside an icing candidate layer: between the larger of the estimated cloud base and the 0 °C height, and the smaller of the cloud top and the −20 °C height.
- It labels each sample with one of four evidence levels: "Observed supercooled layer at planned altitude", "Possible (forecast only)", "Not indicated", or "Not assessed". The route summary gives kilometres and segments per level. There is no single route-wide risk badge.
- It replays two or three consecutive satellite frames and lists which route segments changed level, using only data that would have been available at each time. [TBD: number of cases]
- Observed, forecast, estimated and simulated data are shown with different patterns and text labels, and the screen can be used with the keyboard.

It does not estimate icing severity or probability, it does not give altitude advice, and its accuracy has not been evaluated. "Not assessed" is shown wherever evidence is missing, and is never drawn as clear.

Public app: [TBD URL]. Source: [TBD repository URL].

### How we built it

- Backend: FastAPI and Python. Satellite frames are read from a local cache of GK-2A CTPS level-2 fields. Cloud base is estimated with the statistical method of Noh et al. (2017), with a night-time variant. IFS pressure-level temperature, geopotential height and humidity come from ECMWF Open Data.
- Rules are deterministic. No language model takes part in any assessment. Every response carries its data source, observation time and a rule name and version.
- Frontend: vanilla HTML, CSS and JavaScript on a Canvas chart, with a profile validator and no build step.
- Pre-existing work: the cloud-base estimation, parallax correction and projected-cache format were taken from an earlier project of ours, WeatherPath. The route sampling API surface, flight-profile and layer-fusion rules, evidence levels, replay and the screen were written for this hackathon. The line-by-line table is in `docs/Preexisting_Work_Disclosure.md` [TBD: paste final table here].
- Kiro: see the separate "How Kiro was used" write-up.

### Challenges

- The first plan evaluated one cruise altitude. On a checked Incheon–Tokyo route at FL300, none of 49 segments met the forecast screening condition, because that altitude is much colder than −20 °C. We changed the design to evaluate along the climb and descent profile.
- A passive satellite imager sees only the top cloud layer, so a supercooled layer under higher cloud is invisible to it. We keep "not seen" separate from "not present".
- Cloud base is an estimate, and its error is larger at night. We show the method with each sample and do not clamp it to terrain.
- Keeping a missing value from reading as a clear value affected the data model, the API and the screen.
- Case data: the only archived satellite frame at the time of the review dates from 2026-09-01. [TBD: describe the winter case collected, or state that a labelled simulated case is used.]

### What we learned

[TBD: write from what actually happened during the build. Candidates that are already true: separating "not assessed" from "not indicated" was needed before the data model made sense; the review of cruise-only evaluation changed the scope.] Kiro-specific lessons go in the Kiro write-up, filled from `docs/kiro-usage-log.md`.

### What's next

- Validate against more cases and against independent pilot reports. Until then, no accuracy claim is made.
- Compare with the official GK-2A ICING product and SIGWX/AIRMET over more cases.
- Add terrain to cloud-base clamping and wind to ETA.
- Future work, not part of this submission: fuel-based ranking of candidate routes, route and altitude alternatives, flight-number lookup, a live collection worker, 0.1° IFS, and turbulence products. Code for some of these exists in the repository but is not part of the demo.

### Built with

Python, FastAPI, NumPy, pyproj, netCDF4, JavaScript, HTML Canvas, Kiro, GK-2A (KMA/NMSC), ECMWF Open Data. [TBD: confirm list against final dependencies.]

### Data and attribution

KMA/NMSC GK-2A level-2 products; ECMWF Open Data; Noh et al. (2017). [TBD: exact attribution wording per provider terms.]

---

## 2. Demo video script (under 3 minutes)

Timing follows WO-7 of the review: problem 20 s, winter case and descent exposure 70 s, frame change 30 s, Kiro 40 s, limits and next steps 20 s. That adds up to exactly 3:00. The limit is "under 3 minutes", so trim about 10 s (for example take 5 s from the opening and 5 s from the Kiro section) and aim for a final length of 2:50. Record the video on the deployed URL, not on a local server. Narration is a draft; on-screen actions marked TBD depend on what was built.

| Time | Section | On screen | Narration (draft) |
| --- | --- | --- | --- |
| 0:00–0:20 | Problem | Title, then a map of the route | "Icing forms in supercooled cloud between zero and minus twenty degrees. For short domestic flights that means the climb and the descent. A dispatcher has to join satellite, forecast and the planned altitudes by eye. AeroIcing Watch does that join on one cross-section." |
| 0:20–1:30 | Winter case and descent exposure | Open the public URL. Select the winter case [TBD: case name and route]. Show the cross-section: cloud, candidate layer band, 0 °C and −20 °C lines, planned profile. Step the sample selector into the descent. Show the evidence panel. Show the route summary. | "This is [TBD: route and date]. The grey cloud is from the GK-2A satellite. The band is where supercooled liquid is possible, between the zero and minus twenty degree heights from the ECMWF forecast. The line is the planned climb, cruise and descent. In the descent it enters the band here. The panel says why: the source, the observation time in UTC, and that the cloud base is an estimate. The summary lists kilometres per evidence level. There is no single risk badge." Then show cruise-only evaluation of the same route: no observed sample. [TBD: confirm this is true for the shipped case.] |
| 1:30–2:00 | Frame change | Press next frame. Changed segments highlighted. "What changed" panel. Mention the missing-frame marker if the case has one. | "Now the next satellite frame. These segments changed evidence level. The list gives start and end distance, previous and new level, and the frame that caused it. Replay uses only data available at that time. If a frame is missing, it is marked, and the comparison says how many frames were skipped." |
| 2:00–2:40 | Kiro | [TBD: show only features that were actually used and logged in `docs/kiro-usage-log.md`: the specs folder, steering file, a hook run, a property-based test result, MCP if used.] | "[TBD: write from the usage log. Name what each feature did and what it caught. Do not describe a feature that was not used.]" |
| 2:40–3:00 | Limits and next | Evidence legend and disclaimer. Last card with the URL. | "The satellite sees the top cloud layer only. Cloud base is an estimate. We do not estimate severity or probability, and accuracy is not evaluated. Fuel ranking and route alternatives are future work. Thanks." |

Recording checklist:

- [ ] Total length under 3:00, with margin.
- [ ] Every claim on screen is true in the deployed build.
- [ ] No local paths, API keys or private data visible.
- [ ] Captions or on-screen text for all narration.
- [ ] YouTube video public or unlisted per the rules; link added to Devpost. TBD: confirm requirement.
- [ ] Data attribution visible at least once.

---

## 3. "How Kiro was used" write-up (skeleton)

Rule: write each section only from `docs/kiro-usage-log.md`. If a feature was not used, delete its heading or state that it was not used. Do not write placeholder prose as if it were fact.

### Specs

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### Steering

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### Hooks

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### Property-based testing

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### MCP

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### Spec-driven versus ad hoc prompting

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

### What Kiro got wrong or needed correcting

[fill from docs/kiro-usage-log.md — do not write until the feature was actually used]

---

## 4. Other submission items (checklist)

- [ ] Category: Frankenstein.
- [ ] Public GitHub repository with an open-source license. Apache-2.0 is present; OpenAP (GPL-3 data licence file found in a local copy) compatibility TBD.
- [ ] `/.kiro` at the repository root with specs, steering and hooks, not git-ignored.
- [ ] Working app URL, kept available through the judging period (the review gives 2027-01-29).
- [ ] README "Pre-existing work" section from `docs/Preexisting_Work_Disclosure.md`.
- [ ] Credit application deadline: 2026-12-01 12:00 PT (as stated in the review; verify on the rules page).
- [ ] Optional: blog post and social post with the hackathon hashtag per the rules (verify exact text).
