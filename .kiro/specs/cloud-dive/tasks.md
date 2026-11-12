# Tasks — Cloud Dive

Order follows the submission priorities: P0 eligibility, P1 scored product
and video, P2 Kiro depth, P3 bonuses. Each task names the Kiro feature it
exercises and the judging criterion it serves, so the write-up can be built
from `docs/kiro-usage-log.md`.

Rules for every task:
- All file content in English.
- Do not mark a task done until its check passes.
- After each task, add one row to `docs/kiro-usage-log.md` (feature used,
  what it caught, commit). Rows are written when it happens, never from memory.

Criteria key: IMP Potential Impact · TECH Technological Implementation ·
DES Design · INN Innovation/Idea · PRES Presentation.

Milestones (2026): M0 Nov 14 · M1 Nov 22 · M2 Nov 28 · M3 Dec 2 · submit Dec 3
(one day of buffer before the Dec 4 deadline).

---

## P0 — Eligibility (M0, Nov 14)

- [ ] 0.1 Read the full official rules and record in `requirements.md` §5:
      pre-existing work clause (D5), start date, deadline time zone, video
      limit, Kiro Crew link format. *Manual (owner). Blocking for P1.*
- [ ] 0.2 Resolve D1–D4 with the owner and record the answers.
      *Spec.*
- [ ] 0.3 Bring over from `origin/claude/kiro-research-direction-review-b971c3`
      only: `.kiro/steering/science-guardrails.md`,
      `docs/Preexisting_Work_Disclosure.md`,
      `docs/License_And_Data_Access_Check.md`, `docs/kiro-usage-log.md`.
      Leave the `icing-layer-fusion` and `replay-and-ui` specs on the branch.
      *Steering.* Check: files present on `main`, tests pass.
- [ ] 0.4 Widen the guardrails `fileMatchPattern` to cover
      `src/analysis/**`, `tools/export_cloud_dive.py` and
      `static/cloud-dive/**`. *Steering.*
- [ ] 0.5 Finish the disclosure: fill "to confirm" rows and commit hashes;
      link it from the README (R1.1). *Spec, vibe.*
- [ ] 0.6 Add `THIRD_PARTY_NOTICES.md` (R1.2). Decide OpenAP: keep as an
      unmodified optional dependency. *Vibe.*
- [ ] 0.7 Start the usage log with rows for the Kiro work already in history
      (spec `8745bb8`, hooks `556f8cc`, steering). *Docs.*

## P1 — Scored product and video (M1, Nov 22)

### Evidence rule

- [ ] 1.1 Add `hypothesis` to `requirements.txt`. *Vibe.*
- [ ] 1.2 Write `src/analysis/evidence.py` per design §3–4 (R2). *Spec task
      execution.*
- [ ] 1.3 Unit tests: one per rule row, fixed numbers, synthetic data named
      synthetic. *Spec.*
- [ ] 1.4 Property tests CD-P1 to CD-P5. Record any counterexample Hypothesis
      finds in the usage log. *PBT.* (TECH)

### Cases

- [ ] 1.5 `tools/check_viewer_contract.py` (Python port of `validProfile()`)
      and CD-P8, CD-P9 tests. *PBT.*
- [ ] 1.6 `tools/export_cloud_dive.py`: build cases and `cases/index.json`
      (R3). *Spec task execution.*
- [ ] 1.7 Collect real frames with a supercooled cloud-top signal for at
      least three routes (Korea–Japan, a US–Japan Pacific route, one GOES
      route). Use `tools/collect_goes.py` and `tools/collect_himawari.py`.
      If none by Nov 22, ship a labelled simulated case (R3.4, R3.5).
- [ ] 1.8 Export and commit the cases. Check: exporter validation passes;
      at least one case has observed km > 0. (INN)

### Game

- [ ] 1.9 `static/cloud-dive/` skeleton: case picker, canvas, HUD, persistent
      game-effect note (R4.7). *Spec task execution.* (DES)
- [ ] 1.10 Pure `step()` and client-side evidence evaluation; Node-run tests
      for CD-P6 and CD-P7. *PBT.*
- [ ] 1.11 Rendering: cloud body, estimated-base edge, candidate band, unknown
      curtain, fog, frost (design §6). (DES)
- [ ] 1.12 End-of-dive report and leaderboard (R4.5, R5). (IMP, DES)
- [ ] 1.13 Three "Why?" cards (R4.8). Text checked against the guardrails.
- [ ] 1.14 Keyboard, pointer and touch input; greyscale check (R8). (DES)
- [ ] 1.15 Wording test over `static/cloud-dive/**` and case files (R7).

### Site and dispatcher view

- [ ] 1.16 Change the Pages workflow to assemble `/`, `/route-demo/`,
      `/viewer/` (design §1). Check: signed-out browser loads all three.
- [ ] 1.17 Apply D1 to the dispatcher view (evidence levels and km per level
      instead of the risk badge and altitude suggestions, if accepted).
      Check: existing API tests still pass (R6.1).

### Video and write-up

- [ ] 1.18 Video script, narrated, under 3:00 (R9.1):
      0:00–0:25 problem and audience (IMP) ·
      0:25–1:30 live dive into a real cloud, then the dispatcher view (DES, INN) ·
      1:30–2:30 how Kiro built it: spec → properties → PBT counterexample →
      hooks → steering guardrail catching banned wording → MCP browser check (TECH) ·
      2:30–3:00 what is new and what the satellite cannot see (INN, PRES).
- [ ] 1.19 Rewrite `docs/AeroIcing_Watch_Submission_Package.md`: one
      section per Kiro question in the rules, written only from the usage log;
      state the parts built with other AI tools (R9.2, R9.3).

## P2 — Kiro depth (M2, Nov 28)

Most of these should be in place before the P1 coding tasks they support;
they are listed here because the product comes first if time runs short.

- [ ] 2.1 Command hook: on `*.py` save run `pytest -q`. *Hooks.*
- [ ] 2.2 Command hook: on `*.js` save run `node --check`. *Hooks.*
- [ ] 2.3 PreToolUse hook: block writes to `.env` and `data/` (exit 2).
      *Hooks, sandboxing.*
- [ ] 2.4 Command hook: on save under `static/cloud-dive/` run the wording
      test. *Hooks + steering.*
- [x] 2.5 Update the session-start and progress hooks to read this file.
      *Hooks.* Both hooks now read `cloud-dive/tasks.md`.
- [ ] 2.6 Add a browser MCP server in `.kiro/settings/mcp.json` (verify the
      current package name first) and use it to check the game and the site
      on a narrow viewport. Log what it found. *MCP.*
- [ ] 2.7 Try one Kiro power relevant to the stack; keep it only if it
      changed something. *Powers.*
- [ ] 2.8 Optional: Kiro CLI in GitHub Actions for a review step on pull
      requests. Verify that this surface is available before planning on it.

## P3 — Bonuses (M3, Dec 2)

- [ ] 3.1 Blog post on a third-party platform mentioning "Kiroween Hackathon
      2026": how property-based tests and guardrails kept a weather game honest.
- [ ] 3.2 Social post starting with `#KiroweenHackathon26` with a dive clip.
- [ ] 3.3 Optional Kiro Crew app: a scheduled collector that refreshes
      "Who gets iced the most today?" cases. Only if 0.1 confirms the link
      format and P1 is done.

## Submission (Dec 3)

- [ ] S.1 Upload the video (public) and add the URL to Devpost.
- [ ] S.2 Fill the English Devpost form: category (D4), demo URL, repo URL,
      testing instructions, disclosure link, data attribution.
- [ ] S.3 Final check: `.kiro/` present and not git-ignored, Apache-2.0
      visible, public demo works signed out, all tests pass.
