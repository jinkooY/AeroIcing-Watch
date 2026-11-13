# Submission Checklist - Cloud Dive

Non-coding work for the Kiroween 2026 entry. Coding tasks are in
[`tasks.md`](tasks.md). Decisions are in `requirements.md` section 5; the
official rules digest is in section 6.

Deadline: **Dec 4 2026, 2:00 pm Pacific = Dec 5 07:00 KST**. Submit by
**Dec 3 (KST evening)**. Owner = only the owner can do it. Kiro = done in Kiro.

Milestones: M0 Nov 14 (C2-C5) - M1 Nov 22 (C6-C8, tasks 1-6) -
M2 Nov 28 (C9-C14, tasks 7-8) - M3 Dec 2 (C15-C17, task 9) - submit Dec 3.

## Eligibility and provenance

- [x] C1 Read the full official rules (2026-11-13; digest in `requirements.md` section 6).
- [ ] C2 Confirm F1 to F6 in `requirements.md` section 5.6 and decision D1. Owner.
- [ ] C3 Submit the Kiro Credit Request Form by **Tue Dec 1, 12:00 pm PT
      (Dec 2 05:00 KST)**; redeem the code by Dec 4. Owner.
- [ ] C4 Disclosure: draft exists (`docs/Preexisting_Work_Disclosure.md`,
      `docs/WeatherPath_Reuse_Audit.md`). Owner replaces "Codex or Claude
      (unrecorded in git)" for 33 files with the right name. Add
      `THIRD_PARTY_NOTICES.md` (ECMWF CC BY 4.0, NOAA GOES, IEM PIREP, Noh et al.
      2017, CIRA as referenced work, OpenAP LGPL build-time only). Link both from
      the README. Kiro drafts, owner confirms.
- [x] C5 Legacy components marked in the README and the disclosure (nothing deleted).

## Data (runs, not coding)

- [x] C6 Case scan: strongest routes found (`requirements.md` 5.4 and 5.5);
      GOES-West check for DEN-LAX done (coverage and tops match GOES-East).
- [ ] C7 Collect: GOES hours for the three cases (ACTPC, ACHAC, CODC, CPSC);
      IFS 2026-11-12 00 UTC run, steps +18 and +21 (the +18 index returned HTTP 503
      once; retry), and runs for 11-01 and 11-07 with the extended levels;
      PIREPs from IEM for the case windows. Kiro (task 6.5).
- [ ] C8 Export, tune and commit the case files (task 6.5). Kiro.

## Kiro depth (every item in the rules' write-up list)

- [ ] C9 Surfaces: use at least one surface besides the IDE (CLI for scripts or a
      GitHub Action, Web for a pull request) and record how it differed. Check
      regional availability first (rules: Regional Restrictions).
- [ ] C10 Custom agent: create one with the custom agent creator (candidates: a
      wording guardian that reviews text against the guardrails; a parameter tuner
      that reads the `tune_params.py` report). Log the impact.
- [ ] C11 Browser MCP server in `.kiro/settings/mcp.json` (verify the current
      package name); check the game on a narrow viewport. Log findings.
- [ ] C12 One Kiro power relevant to the stack; keep it only if it changed something.
- [ ] C13 Log at least one real property-test counterexample (task 2.6 or 5.3).
- [ ] C14 Keep `docs/kiro-usage-log.md`: one row per completed task.

## Presentation

- [ ] C15 Video, recorded after the system is complete: English AI voice,
      captions, under 3:00, public on YouTube, shows the app running, no
      third-party logos or music (no CIRA or NOAA screenshots). Check that the
      voice service allows public use.
      0:00-0:25 problem: icing decisions cost fuel - 0:25-1:30 a flight through a
      real icing day: cruise, gate, lane, climb, anti-ice, the dollar total -
      1:30-2:30 how Kiro built it (spec, properties, counterexample, hooks,
      steering catching banned wording, custom agent, MCP check, surfaces) -
      2:30-3:00 references, what is new, what the satellite cannot see.
- [ ] C16 Rewrite `docs/AeroIcing_Watch_Submission_Package.md`: one section per
      question in the rules (surfaces, custom agents, hooks, specs, steering, MCP,
      property-based testing, powers), written only from the usage log; state
      which code came from Codex, Claude and WeatherPath. Kiro drafts.
- [ ] C17 Fill the English Devpost form: category Frankenstein, demo URL,
      repository URL, testing instructions, disclosure link. Save a draft early.

## Bonuses (optional)

- [ ] C18 Blog post on a third-party platform, published before the deadline,
      stating that it is written as part of the Kiroween 2026 hackathon. Owner.
- [ ] C19 Social post that starts with `#KiroweenHackathon26`, with your favourite
      thing about Kiro and how it changed your approach; add the link in the form. Owner.
- [ ] C20 Kiro Crew app in a separate GitHub repo, newly created in the period.
      Only after tasks 1-9 are done.

## Submit (Dec 3)

- [ ] C21 Final check: Pages site up and kept up through **Jan 29 2027**, free and
      without login; Apache-2.0 visible in the repository About section; `/.kiro`
      present and not ignored; all tests pass; draft saved; submitted by Dec 3
      KST evening.