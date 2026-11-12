# Design — Cloud Dive

Requirement ids (R*) refer to `requirements.md`. Properties (CD-P*) in §8 are
the contract for property-based tests.

## 1. Architecture

```
satellite caches (git-ignored)          existing engine (unchanged API)
  GK-2A / GOES-18/19 / Himawari-9  -->  src/analysis/icing_profile.py
                                          build_profile / build_global_profile
                                                   |
                                   NEW src/analysis/evidence.py   (rule v1)
                                                   |
                                   NEW tools/export_cloud_dive.py
                                                   |
                         static/cloud-dive/cases/<case-id>.json  (committed)
                                                   |
  GitHub Pages site root  <-- workflow assembles:  |
    /              static/cloud-dive/   (game, leaderboard, Why? cards)
    /route-demo/   static/route-demo/   (existing Kiroween route comparison)
    /viewer/       static/viewer-standalone.html + viewer.js (dispatcher view)
```

No backend is needed for the public site (R8.3). The FastAPI app stays for the
dispatcher API (R6).

## 2. Modules

| Path | Status | Responsibility |
|---|---|---|
| `src/analysis/evidence.py` | new | Rule `cloud-dive-evidence-v1`: isotherm estimate, candidate layer, evidence level, km summary |
| `tools/export_cloud_dive.py` | new | Select frames and routes, call the profile builder, apply `evidence.py`, validate, write case JSON and `cases/index.json` |
| `tools/check_viewer_contract.py` | new | Python port of `validProfile()` used by the exporter and tests |
| `static/cloud-dive/index.html, game.js, game.css` | new | Game loop, rendering, input, end-of-dive report, leaderboard, Why? cards |
| `static/cloud-dive/cases/` | new, committed | Derived case files only (R1.4) |
| `.github/workflows/route-demo-pages.yml` | changed | Assemble the three-part site root |
| `src/analysis/icing_profile.py`, `src/api/*` | unchanged | Existing behaviour (R6.1) |

## 3. Evidence rule v1 (`evidence.py`)

Inputs per sample: `retrievalState`, `topFt`, `baseFt`, `supercooled`,
`cloudTopTemperatureC`; plus `plannedAltFt`.

```
LAPSE_C_PER_KFT = 1.98        # ISA, uncalibrated screening value, echoed
zeroCFt    = topFt + cloudTopTemperatureC / LAPSE_C_PER_KFT * 1000
minus20CFt = topFt + (cloudTopTemperatureC + 20) / LAPSE_C_PER_KFT * 1000
lowerFt = max(baseFt, zeroCFt)
upperFt = min(topFt, minus20CFt)
candidateLayer = [lowerFt, upperFt] if lowerFt <= upperFt else null
```

| # | Condition (first match wins) | Level | reason |
|---|---|---|---|
| 1 | `retrievalState` not in {observed, clear} | Not assessed | the retrieval state |
| 2 | `retrievalState == clear` | Not indicated | `clear` |
| 3 | `supercooled is null` or `baseFt is null` or temperature null | Not assessed | `evidence_incomplete` |
| 4 | `supercooled == false` | Not indicated | `no_supercooled_signal` |
| 5 | `candidateLayer is null` | Not indicated | `no_candidate_layer` |
| 6 | `lowerFt <= plannedAltFt <= upperFt` | Observed supercooled layer at planned altitude | `inside_candidate_layer` |
| 7 | otherwise | Not indicated | `altitude_outside_candidate_layer` |

Every case carries `rule: {name, version, lapseRateCPerKft,
isothermMethod: "cloud_top_lapse_rate_estimate"}` (R2.6, R2.7).

The rule is a strict subset of the `icing-layer-fusion` table: it never
returns `Possible (forecast only)`, and rows 6–7 match fusion rows 3–4. When
fusion lands, `evidence.py` is replaced by it without changing the case
format.

## 4. Route summary

Each sample owns the interval between the midpoints to its neighbours (first
sample from 0, last to the end). `routeSummary.levels` has all three level
keys with `km` and the list of `[startKm, endKm]` segments. Used by the
leaderboard (R5.2) and the end-of-dive report reference.

## 5. Case file

```json
{
  "schemaVersion": 1,
  "id": "rksi-rjtt-20261120T0300Z-fl180",
  "title": "Incheon to Tokyo Haneda",
  "dataKind": "observation",
  "source": "KMA/NMSC GK-2A CTPS L2 + JMA Himawari-9 (NOAA) ...",
  "attribution": ["..."],
  "observedAt": "2026-11-20T03:00:00Z",
  "flightAlt_ft": 18000,
  "rule": { "name": "cloud-dive-evidence-v1", "version": 1, "...": "..." },
  "routeSummary": { "levels": { "Observed supercooled layer at planned altitude": {"km": 0, "segments": []}, "Not indicated": {}, "Not assessed": {} } },
  "samples": [ { "distanceKm": 0, "topFt": 0, "baseFt": 0, "phase": "liquid", "supercooled": true,
                 "cloudTopTemperatureC": -12.0, "cloudBaseMethod": "dcoew",
                 "zeroCFt": 0, "minus20CFt": 0, "candidateLayer": [0, 0],
                 "evidenceLevel": "...", "evidenceReason": "...", "satelliteSource": "gk2a" } ]
}
```

The legacy fields `icingRisk`, `icingLevel` and `altitudeSuggestions` are
dropped from case files (they are not needed by the game and conflict with
R7). The dispatcher API keeps them pending D1.

## 6. Game

**Loop.** `requestAnimationFrame`; distance advances at a fixed
`GAME_KM_PER_SECOND` (tuned so a case lasts 60–90 s). Input changes target
altitude with a bounded climb rate. All state updates are a pure function
`step(state, inputs, dtSeconds, case)` so they can be tested (CD-P6, CD-P7).

**Sample lookup.** The current sample is the one whose interval (§4) contains
the aircraft distance. Altitude is compared with that sample's evidence at the
aircraft's current altitude, by re-running rule rows 3–7 client-side with the
case's echoed constants (the case stores per-sample inputs, so the client can
evaluate any altitude).

**Rendering (Canvas, reuse viewer palette).**
- Cloud body: phase colour fill from `baseFt` to `topFt`; base edge dashed and
  labelled "estimated base".
- Candidate layer: hatched band.
- `Not assessed`: vertical grey curtain with diagonal hatch and the word
  "Unknown"; never drawn as sky (R4.4).
- In-cloud: screen fog overlay and muffled HUD.
- Ice: frost sprite on wings and windscreen; opacity = clamp(observedKm /
  ICE_KM_FULL, 0, 1).

**HUD.** Altitude, distance, current evidence level as text, observed km,
persistent game-effect note (R4.7).

**End of dive.** km per level (sum equals flown distance, R4.5), case source
and time, a "Why?" card link, replay button, share text without numbers that
imply severity.

**Accessibility.** Arrow keys or W/S; pointer drag; on-screen buttons for
touch. Each level has a text label and pattern (R8.1).

## 7. Leaderboard

Read `cases/index.json` (written by the exporter): per case id, title,
`flightAlt_ft`, `observedAt`, source, and km per level. Sort by observed km,
then by fewer `Not assessed` km. Show all three km values on every row (R5.2).

## 8. Correctness properties (PBT, Hypothesis)

| Id | Property | Requirement |
|---|---|---|
| CD-P1 | Not assessed is sticky: any sample with `retrievalState` outside {observed, clear}, or with null supercooled/base/temperature, is `Not assessed` for every planned altitude | R2.2, R2.5 |
| CD-P2 | Observed implies evidence: `Observed` ⇒ `retrievalState == observed`, `supercooled is true`, and `lowerFt <= plannedAltFt <= upperFt` | R2.4 |
| CD-P3 | Layer containment: when `candidateLayer` is non-null, `baseFt <= lowerFt <= upperFt <= topFt` | R2.6 |
| CD-P4 | Isotherm ordering: `minus20CFt >= zeroCFt` for every finite temperature | R2.6 |
| CD-P5 | Summary conservation: km over the three levels sums to the last `distanceKm` within 0.001; every sample is in exactly one segment | §4, R5.2 |
| CD-P6 | Dive conservation: for any input sequence, final km per level sums to distance flown within 0.001; observed km is non-decreasing over time | R4.5, R4.3 |
| CD-P7 | Determinism: evidence and `step` give equal output for equal input (Python and a Node-run check of `game.js`) | R2.8, R4.6 |
| CD-P8 | Viewer validity: every exported case passes the ported `validProfile()` | R3.2 |
| CD-P9 | JSON finiteness: no NaN or infinity anywhere in a case | R3.3 |
| CD-P10 | Route sampling: distances start at 0, strictly increase, count in [10, 200], and adjacent spacing stays bounded across the dateline | R3.1 |

Unit tests cover each rule row in §3 with fixed numbers. A wording test scans
`static/cloud-dive/**` and case files for the R7.1 terms.

## 9. Error handling

- Missing or unreadable case file: show the case list with the entry
  disabled and the reason; never a blank canvas.
- No case with observed km: the leaderboard shows the honest result and the
  game still plays (R3.4, R3.5).

## 10. Out of scope

3D flight (the CesiumJS replay stays on its branch), physics-based icing
accretion, live collection on the public site, fuel and flight lookup, any
operational advice.
