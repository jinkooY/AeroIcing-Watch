# Cloud Dive: how Kiro was used (Kiroween 2026 write-up)

Written on 2026-11-19 (checklist C16). Every statement comes from [`kiro-usage-log.md`](kiro-usage-log.md)
(one row per task, 2026-11-11 to 2026-11-19), the spec in [`.kiro/specs/cloud-dive/`](../.kiro/specs/cloud-dive/)
or the git history. This text is pasted into the Devpost "How Kiro was used" field
([`devpost-draft.md`](devpost-draft.md)).

[Play Cloud Dive](https://jinkooy.github.io/AeroIcing-Watch/) ·
[Repository](https://github.com/jinkooY/AeroIcing-Watch) ·
[Origin of every file](Preexisting_Work_Disclosure.md)

## 1. Kiro IDE and Kiro CLI: how they differed

Almost all of Cloud Dive was built in **Kiro IDE**: spec task execution for 131 of 132 sub-tasks in 25 groups
(23.4, the final recording, waits for the frozen build), and chat for playtest fixes and the video tools. **Kiro CLI 3.4.0** ran the wording review headless:

```
kiro-cli chat --no-interactive --agent wording-guardian-cli --trust-tools=fs_read "<what to review>"
```

The difference was concrete. The CLI did not load the IDE's Markdown agent ("Mode not found"). It needed a
JSON agent beside the Markdown one, both pointing at one prompt file; `kiro-cli agent upgrade` brought the JSON
file to the CLI's current format. After that the review became a scriptable, read-only step (the two timed
runs took 63 s and 140 s). Four CLI
runs found, among others, a wrong rule name in the README (the forecast screen named as the evidence rule)
and four factual errors about this repository in the first blog draft. Kiro Web and Kiro Crew were not used.

## 2. Spec-driven development, compared with vibe coding

The first two days (2026-11-11 to 11-12) were vibe chat on an earlier prototype. A 27-check smoke test then
found 5 failures, and a vibe draft of satellite support guessed "supercooled" from temperature, which was
wrong and was removed. From 2026-11-13 the game was built from one spec,
[`cloud-dive`](../.kiro/specs/cloud-dive/): 25 requirement groups, a design with 36 numbered correctness
properties (CD-P1 to CD-P36), 18 recorded decisions (G1 to G18: 12 by the owner, 4 Kiro judgements the owner
could veto, 2 recorded findings), and tasks in dependency waves.

The spec went through six revisions (a to f) as playtests and reviews came in. Each revision added
requirements and a decision record; for revision b the spec changed first, with no code. Two examples of the
spec doing work that vibe coding skipped:

- Turning the evidence table into code exposed three gaps in our own rules: a humid forecast could mark a
  clear-sky pixel *Possible*; a cell above the cloud top became *Not assessed* only because isotherms were
  missing; a satellite-supercooled cell with missing isotherms could fall through to *Not indicated*.
- Writing property CD-P14 forced a decision the spec had left open: a gate re-fired at every step while
  approaching a cloud. An entry is now announced once, at most two segments before the cell.

## 3. Steering

Two steering files. `project.md` (always included) fixes the scope rules: no language model in the
decision, the frozen viewer JSON contract, no build step. `science-guardrails.md` is included by file match
whenever analysis, exporter or game files are in context. It was imported from an earlier research review
(written with Claude, branch `claude/kiro-research-direction-review-b971c3`) and amended by Kiro. It holds the four evidence level names, the words
the project may never use about the atmosphere, and the rule that *Not assessed* never turns into
*Not indicated*. It was amended once, on 2026-11-13, to allow a labelled game ice index and illustrative
dollar costs while keeping the ban on severity words and on suggestions. The strategy that mattered most:
put the science rules in a file that loads with the code, then test them (sections 4 and 5).

## 4. Agent hooks

Six hooks in [`.kiro/hooks/`](../.kiro/hooks/):

| Hook | Trigger | What it did |
|---|---|---|
| Wording test | save under `static/cloud-dive/` | Runs `tests/test_wording.py`. When the test was written it found real violations: a banned wording for cells without data (now *Not assessed*) and a card that wrongly implied the cloud had been checked and found clear (rewritten to describe the cloud top the satellite sees). The save hook is configured; a run inside the IDE is not logged |
| `pytest` on Python save, `node --check` on JavaScript save | file save | Syntax and test feedback without asking |
| Protect `.env` and `data/` | before any agent write, rename or delete | Blocks agent writes to secrets and the satellite cache (tested by piping sample payloads, 6 of 6) |
| Session-start status | session start | Prints progress, days to the deadline and open owner items |
| Task progress | save of `tasks.md` | Reports progress per group and reminds that each task needs a usage-log row |

The progress hook reminds us to add a usage-log row after each task; some rows cover several tasks.

## 5. Custom agent

`wording-guardian` is a read-only custom agent ([`.kiro/agents/`](../.kiro/agents/)). It reviews the text that
the wording test cannot scan: the video script, the README, the blog and the Devpost text. Its first run, on
the video script, failed with 14 findings, none of them a banned word: every finding was a claim a word list
cannot catch. Two were about Kiro itself ("We built it all in Kiro" contradicted the disclosure; a hook claim
was more than the log showed). Later runs caught a script line we had written that presented forecast-only cells as icing evidence; it now
says "Possible or Observed evidence". The agent runs in the IDE and, in its JSON form, in the
CLI (section 1).

## 6. MCP

The **Playwright MCP server** (`@playwright/mcp`, configured by the owner in `.kiro/settings/mcp.json`) let
Kiro open the game at 390 x 844 and read the page. It found that the gate buttons sat below the fold on a
phone. That led to the phone layout of revision e and one automatic scroll per gate; a second MCP check
confirmed the windshield, buttons and settings line on one screen.

## 7. Powers

The **BrowserStack power** drove Chrome on a real Samsung Galaxy S25 Ultra (Android 15) through Device
Control. Its viewport is 697 CSS pixels tall, and after the climb the Continue button sat 6 pixels below the
fold, which the 390 x 844 check had missed. The fix was one function in `gate-panel.js`; a second device
session passed. The power was kept because it changed the game.

## 8. Property-based testing

Hypothesis (Python) properties and seeded random tests (`node --test`, JavaScript) cover containment,
ordering, determinism, conservation, *Not assessed never becomes Not indicated*, and Python-JavaScript
parity on two of the three cases (the full engine state after every one of 60 random scripts). The parity
test passed on its first run, so its power was checked with two deliberate mutations in `engine.js`; both
made it fail. One property found a real counterexample: the video caption splitter wrapped at 42 characters
but nothing capped the lines at two. Hypothesis shrank a failing input to a one-letter sentence followed by a
long one; the merge rule joined them into three lines. The real script failed the same way, and the fix
went in before the final video.

On 2026-11-19: 323 pytest tests and 265 Node tests pass (re-run on the frozen build before submission).

## 9. What Kiro did not do

- **Other AI tools.** Claude wrote the first backend files and corrected Kiro's satellite drafts (2026-11-11 to
  11-12). Later it reviewed the video plan and a code revision, wrote instructions that Kiro carried out, and
  wrote a list of pending items. The science guardrails steering file was imported from a Claude-assisted
  research review and amended by Kiro.
  Codex wrote the legacy Incheon-Haneda route demo. Those files stay in the repository, most of them marked
  legacy.
- Kiro wrote the Cloud Dive game, engine, exporter and video tools. They reuse a few modules of Claude or
  WeatherPath origin (for example `cloud_base.py`, `ifs_grid.py`, `collect_ifs.py`), listed per file in
  [`Preexisting_Work_Disclosure.md`](https://github.com/jinkooY/AeroIcing-Watch/blob/main/docs/Preexisting_Work_Disclosure.md).
- Parts of the cloud-base method and grid code were copied or adapted from the author's earlier WeatherPath
  project ([reuse audit](https://github.com/jinkooY/AeroIcing-Watch/blob/main/docs/WeatherPath_Reuse_Audit.md)).
- The owner made most decisions G1 to G18 (G4, G6, G7 and G8 are Kiro judgements the owner could veto),
  created the MCP configuration, ran the BrowserStack account and records the Kiro screens of the video.
