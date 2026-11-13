# Kiro usage log

One row per real use of a Kiro feature. Add a row when it happens, not afterwards from memory. The
"How Kiro was used" write-up in `docs/AeroIcing_Watch_Submission_Package.md` is written only from this log.
Do not add rows for features that were not used.

Columns: Date (UTC, YYYY-MM-DD) - Kiro feature - What was asked - Outcome - What it caught or changed - Commit.

| Date | Kiro feature | What was asked | Outcome | What it caught or changed | Commit |
| --- | --- | --- | --- | --- | --- |
| 2026-11-11 | spec + steering | Turn the idea (GK-2A icing cross-section for airlines) into requirements, design, tasks and a project steering file. | Kept as the first plan; later superseded by the `cloud-dive` spec. | Fixed scope rules early: the viewer JSON contract stays unchanged, no language model in the assessment, fallback to sample data when no cache exists. | 8745bb8, 71514ac |
| 2026-11-12 | hooks (agent) | Report task progress automatically. | Two agent hooks: on save of `tasks.md` and at session start. Prompts were rewritten twice as the plan changed. | Gave a progress count after every `tasks.md` save. | 556f8cc |
| 2026-11-12 | vibe chat | Finish the backend, frontend and docs of the first plan. | Kiro wrote the icing assessment and altitude suggestions, the route form page, the chart's planned-altitude line, the README and docs. Backend files that already existed in the working tree were committed with it. | A 27-check smoke test found 5 failures: the stale-cache fallback lacked `icingRisk`, `altitudeSuggestions` and the disclaimer. Fixed. | 257f7d8 |
| 2026-11-12 | vibe chat | Draft global satellite support (GOES, Meteosat, router). | Draft was never committed by Kiro; Claude imported and corrected it. | Later review showed the draft guessed "supercooled" from temperature and treated GOES-16 as current. Both were wrong and were removed by the later pass. | (stash, 10298ce) |
| 2026-11-13 | spec (rules review) | Read the full Kiroween rules and check the plan against them. | Rules digest added to the spec. | Two required write-up questions were missing from the plan (compare IDE, CLI, Web, Crew; custom agents). Credit form deadline and the demo-availability date (2027-01-29) found. | 12140c4 |
| 2026-11-13 | spec (data check) | Scan 12 days and 53 hubs for real GOES supercooled cloud tops and icing reports. | Cases and the worst day (2026-11-12) chosen from data. | The 21 UTC hour at New York is past the project's solar-zenith limit (84 degrees), so 19-20 UTC is used. GOES cloud-top height is geopotential (sea-level) height. | f6e33b4, 1622539 |
| 2026-11-13 | spec (design review) | Rewrite the spec for a fuel-cost score and decision-gate flow. | New requirements, design (16 properties) and 46 coding tasks. | First cost rules would let "anti-ice only inside cloud" always win because its price is far below the price of avoiding. The owner's F3 amendment (penalties on both anti-ice choices) plus balance criteria B1-B4 were added. | 145b0a6 |
| 2026-11-13 | steering | Import and amend the science guardrails (task 1.1). | `.kiro/steering/science-guardrails.md`, file-match steering for analysis, exporter and game files. | Amended to allow a labelled game ice index and dollar costs while keeping the ban on severity wording and on suggestions. | (this commit) |
| 2026-11-13 | hooks (command) | Run tests on `.py` save, `node --check` on `.js` save, and block writes to `.env` and `data/` (tasks 1.2 to 1.4). | Three command hooks plus two small scripts under `.kiro/hooks/scripts/`. | The default PowerShell execution policy refused script files, so the commands pass `-ExecutionPolicy Bypass` for that process only. Tested all cases by piping sample payloads (guard: 6 of 6, syntax check: 4 of 4). | (this commit) |
