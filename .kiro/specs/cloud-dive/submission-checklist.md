# Submission Checklist - Cloud Dive

Non-coding work for the Kiroween 2026 entry. Coding tasks are in
[`tasks.md`](tasks.md). Decisions are in `requirements.md` section 5; the
official rules digest is in section 6.

Deadline: **Dec 4 2026, 2:00 pm Pacific = Dec 5 07:00 KST**. Submit by
**Dec 3 (KST evening)**. Owner = only the owner can do it. Kiro = done in Kiro.

Milestones: M0 Nov 14 (C1-C5) - M1 Nov 22 (C6-C8, coding tasks 1-5) -
M2 Nov 28 (C9-C14) - M3 Dec 2 (C15-C17) - submit Dec 3.

## Eligibility and provenance

- [x] C1 Read the full official rules (done 2026-11-13; digest in
      `requirements.md` section 6).
- [ ] C2 Answer W1, W2, W3 in `requirements.md` section 5.3. Owner.
- [ ] C3 Submit the Kiro Credit Request Form by **Tue Dec 1, 12:00 pm PT
      (Dec 2 05:00 KST)**; redeem the code by Dec 4. Owner.
- [ ] C4 Rewrite `docs/Preexisting_Work_Disclosure.md` (decisions P8, P9):
      per file, origin = WeatherPath / Codex / Claude / Kiro; use branch and
      commit history (`claude/*`, `codex/*`, Kiro commits). Owner confirms
      every "to confirm" row. Add `THIRD_PARTY_NOTICES.md` (ECMWF Open Data
      CC BY 4.0, NOAA GOES, IEM/NWS PIREP, Noh et al. 2017, CIRA as a
      referenced product, OpenAP only if kept). Link both from the README.
- [ ] C5 Mark code outside the new scope (GK-2A reader, WeatherPath importer,
      Meteosat and Himawari sources, fuel route review) as legacy in the
      README so judges know what the entry is. Do not delete. Owner approves.

## Data

- [ ] C6 Case check (W3): per candidate (2026-11-02 Colorado, 2026-11-01 Ohio,
      2026-11-07 New York area), daytime hour, GOES-West or GOES-East frame,
      supercooled pixels on a feasible route, PIREP icing reports within the
      window. Pick airport pairs. Kiro.
- [ ] C7 Collect for each chosen case: GOES ACHAC, ACTPC, CODC, CPSC;
      IFS run via `tools/collect_ifs.py --source aws` with 700 hPa added;
      PIREPs from IEM for the case window. Kiro.
- [ ] C8 Export and commit the case JSON (coding task 3). Kiro.

## Kiro depth (every item in the rules' write-up list)

- [ ] C9 Surfaces: use at least one surface besides the IDE (CLI for scripts or
      a GitHub Action, Web for a pull request) and record how it differed.
      Check regional availability first (rules: Regional Restrictions).
- [ ] C10 Custom agent: create one with the custom agent creator
      (candidates: a wording guardian that reviews text against the
      guardrails; a case curator that scores candidate cases). Log the impact.
- [ ] C11 Browser MCP server in `.kiro/settings/mcp.json` (verify the current
      package name); check the game and site on a narrow viewport. Log findings.
- [ ] C12 One Kiro power relevant to the stack; keep it only if it changed
      something.
- [ ] C13 Log at least one real PBT counterexample (coding task 2.6).
- [ ] C14 Keep `docs/kiro-usage-log.md`: one row per completed task.

## Presentation

- [ ] C15 Video, recorded after the system is complete (P6):
      English AI voice, captions, under 3:00, public on YouTube, shows the app
      running on its device, no third-party logos or music (no CIRA or NOAA
      screenshots). Check that the voice service allows public use.
      0:00-0:25 problem and audience - 0:25-1:30 a dive into a real cloud -
      1:30-2:30 how Kiro built it (spec, properties, counterexample, hooks,
      steering catching banned wording, custom agent, MCP check, surfaces) -
      2:30-3:00 what is new and what the satellite cannot see.
- [ ] C16 Rewrite `docs/AeroIcing_Watch_Submission_Package.md`: one section
      per question in the rules (surfaces, custom agents, hooks, specs,
      steering, MCP, PBT, powers), written only from the usage log; state
      which code came from Codex and Claude (P8).
- [ ] C17 Fill the English Devpost form: category Frankenstein, no bonus
      categories except those done in C18-C20, demo URL, repository URL,
      testing instructions, disclosure link. Save a draft early.

## Bonuses (optional)

- [ ] C18 Blog post on a third-party platform, published before the deadline,
      stating that it is written as part of the Kiroween 2026 hackathon. Owner.
- [ ] C19 Social post that starts with `#KiroweenHackathon26`, with your
      favourite thing about Kiro and how it changed your approach; add the link
      in the form. Owner.
- [ ] C20 Kiro Crew app in a separate GitHub repo, newly created in the period.
      Only after coding tasks 1-6 are done.

## Submit (Dec 3)

- [ ] C21 Final check: Pages site up and kept up through **Jan 29 2027**, free
      and without login; Apache-2.0 visible in the repository About section;
      `/.kiro` present and not ignored; all tests pass; draft saved; submitted
      by Dec 3 KST evening.