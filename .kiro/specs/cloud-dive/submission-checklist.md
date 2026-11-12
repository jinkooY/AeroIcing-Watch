# Submission Checklist - Cloud Dive

Non-coding work for the Kiroween 2026 entry. Coding tasks are in
[`tasks.md`](tasks.md). Deadline 2026-12-04 (time zone to confirm in C1).

Milestones: M0 Nov 14 (C1-C3) - M1 Nov 22 (C4, coding tasks 1-5) -
M2 Nov 28 (C5-C9) - M3 Dec 2 (C10-C12) - submit Dec 3.

## Eligibility (blocking)

- [ ] C1 Read the full official rules; record in `requirements.md` section 5:
      pre-existing work clause (D5), start date, deadline time zone, video
      limit, Kiro Crew link format.
- [ ] C2 Decide D1-D4 with the owner and record the answers.
- [ ] C3 Bring over from `origin/claude/kiro-research-direction-review-b971c3`:
      `docs/Preexisting_Work_Disclosure.md`,
      `docs/License_And_Data_Access_Check.md`, `docs/kiro-usage-log.md`.
      Fill the "to confirm" rows and commit hashes; add
      `THIRD_PARTY_NOTICES.md`; link both from the README (R1.1, R1.2).
      Start the usage log with the Kiro work already in history
      (spec `8745bb8`, hooks `556f8cc`, cloud-dive spec `5cb4032`).

## Data

- [ ] C4 Collect real frames with a supercooled cloud-top signal for at least
      three routes (Korea-Japan, a US-Japan Pacific route, one GOES route)
      with `tools/collect_goes.py` and `tools/collect_himawari.py`. If none by
      Nov 22, use the simulated case from task 3.6 (R3.4, R3.5).
- [ ] C5 Run the exporter on the collected frames and commit the case files.

## Kiro depth

- [ ] C6 Add a browser MCP server (verify the current package name first) and
      use it to check the game and site on a narrow viewport. Log findings.
- [ ] C7 Try one Kiro power relevant to the stack; keep it only if it changed
      something.
- [ ] C8 Optional: Kiro CLI review step in GitHub Actions, after confirming
      the surface is available.

## Presentation

- [ ] C9 Narrated video under 3:00 (R9.1):
      0:00-0:25 problem and audience - 0:25-1:30 a dive into a real cloud,
      then the dispatcher view - 1:30-2:30 how Kiro built it (spec,
      properties, a PBT counterexample, hooks, a guardrail catching banned
      wording, MCP check) - 2:30-3:00 what is new and what the satellite
      cannot see.
- [ ] C10 Rewrite `docs/AeroIcing_Watch_Submission_Package.md`: one section per
      Kiro question in the rules, written only from the usage log; state the
      parts built with other AI tools (R9.2, R9.3).

## Bonuses

- [ ] C11 Blog post on a third-party platform mentioning "Kiroween Hackathon 2026".
- [ ] C12 Social post starting with `#KiroweenHackathon26` with a dive clip.
- [ ] C13 Optional Kiro Crew app that refreshes the leaderboard cases, only if
      C1 confirms the link format and coding tasks 1-6 are done.

## Submit (Dec 3)

- [ ] C14 Upload the video (public) and add the URL to Devpost.
- [ ] C15 Fill the English Devpost form: category (D4), demo URL, repo URL,
      testing instructions, disclosure link, data attribution.
- [ ] C16 Final check: `.kiro/` present and not git-ignored, Apache-2.0
      visible, public demo works signed out, all tests pass.