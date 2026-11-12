# Design — Replay and UI

Draft for Kiro to refine. Implements `requirements.md` in this folder. Depends on the response shape in `.kiro/specs/icing-layer-fusion/design.md`. No code is prescribed; names are proposals.

## 1. Replay

### 1.1 Case files

A case is a directory (location TBD) with a manifest and the data it references.

Manifest fields (proposal):

- `caseId`, `title`, `dataKind` (`observation` or `simulated`)
- `route`: endpoints (lat, lon) and optional ICAO labels
- `flightProfile`: parameters from the fusion spec, including `departureAt`
- `frames[]`: ordered by observation time; each has `observedAt` (UTC), `framePath`, `opticsPath` (optional), `receivedAt` (UTC or null), `availability` (`recorded`, `unverified` or `simulated`), `simulatedDelayMin` (when simulated)
- `ifsBundles[]`: paths and the receipt times already stored in each bundle
- `reference` (optional): captured SIGWX or AIRMET image path, source and time. TBD.

The cache layout of frames follows `src/integration/gk2a_cloud.py` (`FIELD/KO/YYYYMMDD/YYYYMMDDHHMM.npz`). Whether cases point into the cache or contain copies is TBD; for deployment, processed profiles per frame may be stored instead of raw grids (see section 4).

### 1.2 Replay computation

```
for each decision time T in the case (one per frame, plus optional intermediate times TBD):
    eligible frames  = frames with observedAt <= T and availableAt <= T
    latest frame     = last eligible frame
    IFS bundle       = choose_bundle(received <= T)
    profile(T)       = fusion build for latest frame, bundle, route, flight profile
for each pair of consecutive available profiles (A, B):
    per-sample level A vs level B -> changed segments
```

Two functions, both pure:

- `evaluate_at(case, T)` returns a fusion profile or a frame status. It must not read any file whose time is after `T`.
- `compare(profileA, profileB)` returns changed segments, `unchanged`, `skippedFrames`, `spanMin`.

`availableAt` is `receivedAt` when recorded, else `observedAt + simulatedDelayMin` when `availability == simulated`. If neither exists the frame is `availability_unverified` and the case must be given a simulated schedule before replay (requirement 1.4).

### 1.3 Change segments

Samples are identical across frames (same route and sample distances), so comparison is per index. For each sample `i` with level `a[i]` in profile A and `b[i]` in profile B, where `a[i] != b[i]`: record `(a[i], b[i])`. Adjacent samples with the same pair merge. Segment bounds use the midpoint interval rule from the fusion design, section 6. Kind is `level_change`, or `coverage_change` if either side is `Not assessed`.

Segment output: `startKm`, `endKm`, `previousLevel`, `newLevel`, `kind`, `previousFrame`, `evidenceFrame`, `previousReason`, `newReason`.

### 1.4 Missing frames

Frame statuses: `ready`, `missing`, `corrupt`, `stale`. Comparison pairs are formed from consecutive `ready` frames only. Between a pair separated by `k` non-ready frames: `skippedFrames = k`, `spanMin = B.observedAt - A.observedAt` in minutes. The UI must not describe this as a one-step change.

### 1.5 API

A new endpoint is proposed, additive to the existing ones: `GET /api/icing/replay?case=<id>` returning the case, a `frames[]` list with `frameStatus`, `decisionAt`, `availableAt`, `availability`, and a `transitions[]` list with the changed segments. A second endpoint or parameter returns the full fusion profile for one frame so the UI can draw it: for example `GET /api/icing/replay/frame?case=<id>&at=<UTC>`. Names TBD.

Responses carry `ruleName`, `ruleVersion`, the case `dataKind` and, when relevant, `deliverySchedule: "simulated"`.

## 2. UI

### 2.1 Layout (desktop)

```
+---------------------------------------------------------------+
| AeroIcing Watch      [Simulated banner when applicable]       |
+---------------+-----------------------------------+-----------+
| Route         |  Map (small): route + domain box  | Evidence  |
| From / To     +-----------------------------------+ panel for |
| Cruise alt    |                                   | selected  |
| Elevations    |  Cross-section (canvas)           | sample:   |
| Case select   |  cloud, candidate layer band,     | level,    |
|               |  0 C and -20 C lines, planned     | reason,   |
| Route summary |  altitude line, changed segments  | source,   |
| km per level  |                                   | time,     |
|               |  sample slider                    | quality,  |
|               |                                   | base      |
|               |                                   | method    |
+---------------+-----------------------------------+-----------+
| Frame control: [prev] time markers (gaps marked) [next]       |
| What changed list                                              |
+---------------------------------------------------------------+
| Footer: sources, disclaimer                                    |
+---------------------------------------------------------------+
```

Narrow screens stack the regions vertically in this order: banner, route panel, map, cross-section, evidence, frame control, footer.

The cross-section reuses `static/viewer.js` for the chart, slider and validation. Added drawing (candidate layer, isotherms, flight profile line, changed-segment markers) is limited to the additive fields. How much of `viewer.js` to extend versus wrap is TBD; the constraint is that `validProfile()` and offline operation stay intact.

### 2.2 Data-kind encoding

Proposed encoding, to be refined with Kiro. Each kind has a pattern and a text tag; colour is secondary.

| Data kind | Applies to | Pattern (proposal) | Text tag |
| --- | --- | --- | --- |
| Observed | cloud top, phase, supercooled signal | solid fill, solid outline | "Observed" |
| Forecast | IFS isotherm lines, forecast criterion | long-dash line, diagonal hatch | "Forecast" |
| Estimated | cloud base, lapse-rate isotherms | dotted outline, light fill | "Estimated" |
| Simulated | bundled sample, generated frame | cross-hatch fill, banner | "Simulated" |

Evidence levels need a second, independent encoding in the segment strip and the route summary: pattern plus text for all four levels, including `Not assessed` (proposal: empty box with diagonal strike) and `Not indicated` (proposal: plain light fill). Check greyscale legibility of all eight combinations.

### 2.3 Wording rules

Fixed strings come from one constants block so they can be tested: the four evidence-level strings, "Simulated", "Not assessed", "No change in evidence level between these frames", the disclaimer and the attribution footer. A test scans the UI source and API text for the banned phrases in requirement 10.1 and 10.3.

### 2.4 Keyboard and focus

Tab order: route inputs, case selector, cross-section slider, frame previous, frame next, legend toggle, evidence panel. The slider keeps arrow-key stepping. The frame control accepts left and right arrows. An ARIA live region (polite) announces the selected sample's evidence level and reason. Focus indicators are visible. The legend is a button that opens a list, not a hover-only element.

### 2.5 States

| State | Trigger | Display |
| --- | --- | --- |
| Empty | no route entered | bundled sample, "Simulated" banner, one-line instruction |
| Out of domain, partial | some samples `outside_domain` | those stretches shown as Not assessed with reason "outside satellite domain" |
| Out of domain, whole | all samples outside | message; no cross-section drawn as clear |
| No data | frame missing, corrupt or stale | reason and frame time; simulated sample only if no archived frame was selected |
| Frame gap | non-ready frames in the case | gap markers in the frame control |
| Error | request failure | message, retry, previous profile kept and marked |
| Loading | request in progress | indicator; controls usable |

### 2.6 Map

A small map with the route line, sample dots and the domain rectangle. Leaflet 1.9.4 vendoring is in the old tasks and `frontend/vendor/` is empty at the time of writing; a static SVG outline is an alternative if Leaflet adds weight. Decision: TBD. Any map tiles require attribution; offline operation requires no tile dependency (TBD).

## 3. Correctness properties

For property-based testing.

R1. No look-ahead. For any case and any decision time `T`, the evaluation reads only frames and bundles with observation, receipt (actual or simulated) at or before `T`. Test by generating cases with frames after `T` containing sentinel values and asserting those values never appear in the output.

R2. Replay determinism and idempotence. Evaluating the same case twice gives equal output; running the comparison twice gives no duplicate segments.

R3. Segment well-formedness. For any pair of profiles, every changed segment has `0 <= startKm < endKm <= routeLengthKm`, segments do not overlap, and segments are ordered by `startKm`.

R4. Change completeness. The set of sample indices covered by changed segments equals exactly the set of indices where the two levels differ.

R5. Identity. `compare(P, P)` is empty with `unchanged == true`.

R6. Antisymmetry. Swapping A and B swaps `previousLevel` and `newLevel` and keeps segment bounds the same.

R7. Coverage changes. Any sample changing to or from `Not assessed` appears as `coverage_change`, never as `level_change`.

R8. No substitution for missing frames. If a frame is not `ready`, no output field derives from that frame's data, and `skippedFrames` equals the number of non-ready frames between the pair.

R9. Banned content. No response text contains an altitude suggestion field, a fuel field, a ranking field, or the phrases listed in requirement 10.1.

R10. Viewer validity. Every frame profile returned by the replay API passes the `validProfile()` rules (as in the fusion spec, P10).

R11. Greyscale distinctness. The eight pattern/label combinations are pairwise distinguishable by text label (the test checks labels; pattern distinctness is reviewed manually).

## 4. Deployment notes (WO-6, outside this spec's tasks)

The review asks for a public URL that works without API keys and with archived data embedded. For the replay, processed per-frame profiles (JSON) are the likely shipped artefact, rather than raw KMA grids; the redistribution terms of KMA data must be confirmed first (TBD). Nothing in this spec depends on that choice except where case files are stored.

## 5. Testing plan

Unit tests for `compare`, `evaluate_at`, frame status handling; property tests R1 to R11; fixtures: one case with a change, one case with a missing frame, one case with a sentinel frame after the decision time. UI tests are manual or browser-based (tool TBD): keyboard-only run through the 30-second scenario, empty, out-of-domain, no-data and error states, a scan for banned phrases, and a greyscale screenshot check.
