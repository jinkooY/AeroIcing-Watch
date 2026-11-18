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
- [x] C2 Confirm F1 to F6 in `requirements.md` section 5.6. Owner. (D1 decided: replace.)
      Done: section 5.6 reads "approved 2026-11-13, F3 amended".
- [x] C3 Submit the Kiro Credit Request Form by **Tue Dec 1, 12:00 pm PT
      (Dec 2 05:00 KST)**; redeem the code by Dec 4. Owner.
      Done: the owner reports the credits are received (2026-11-17).
- [ ] C4 Disclosure: attribution settled (files git cannot attribute = Claude, owner
      statement 2026-11-13). Remaining: add `THIRD_PARTY_NOTICES.md` (ECMWF CC BY 4.0, NOAA
      GOES, IEM PIREP, Noh et al. 2017, CIRA as referenced work, OpenAP LGPL build-time
      only), link the disclosure and audit from the README, owner reads the final table.
      Note (task 20.1, 2026-11-14): Kiro drafted the revision b parts. `THIRD_PARTY_NOTICES.md`
      has three.js 0.160.1 (MIT, SHA-256), OurAirports (public domain) and a data table (ECMWF,
      NOAA, Natural Earth, Noh, OpenAP, CIRA); IEM PIREP is not listed because no PIREP data is
      used in the game. The README links the disclosure and notices. The disclosure has new
      section 7 (revision a and b files by origin, all Kiro). Still the owner's: read the
      table and section 7, confirm the ECMWF and NOAA attribution wording, check the three.js
      SHA-256 with `Get-FileHash`, and confirm the final commit of each file.
- [x] C5 Legacy components marked in the README and the disclosure (nothing deleted).

## Data (runs, not coding)

- [x] C6 Case scan: strongest routes found (`requirements.md` 5.4 and 5.5);
      GOES-West check for DEN-LAX done (coverage and tops match GOES-East).
- [x] C7 Collect: GOES hours for the three cases (ACTPC, ACHAC, CODC, CPSC);
      IFS 2026-11-12 00 UTC run, steps +18 and +21 (the +18 index returned HTTP 503
      once; retry), and runs for 11-01 and 11-07 with the extended levels;
      PIREPs from IEM for the case windows. Kiro (task 6.5).
- [x] C8 Export, tune and commit the case files (task 6.5). Kiro.
      Done: task 6.5; three cases committed in `static/cloud-dive/cases/` (the C7 data went into them).

## Kiro depth (every item in the rules' write-up list)

- [x] C9 Surfaces: use at least one surface besides the IDE (CLI for scripts or a
      GitHub Action, Web for a pull request) and record how it differed. Check
      regional availability first (rules: Regional Restrictions).
      Done 2026-11-18: Kiro CLI 3.4.0, headless (`kiro-cli chat --no-interactive --agent wording-guardian-cli
      --trust-tools=fs_read`), 63 s. Differences from the IDE: the CLI does not load the IDE's Markdown agent
      (`wording-guardian.md`: "Mode not found"); it needs a JSON agent, and `kiro-cli agent upgrade` converted it
      to the format both engines load (`.kiro/agents/wording-guardian-cli.json`, same prompt file). The CLI run
      is scriptable and read-only by flag. It returned 12 verdicts: PASS, 4 should-fix; 3 applied to the
      script (g1, d4, k3b) and h2 "Fuel cost is your score"; item 1 was already true in the code.
- [x] C10 Custom agent: create one with the custom agent creator (candidates: a
      wording guardian that reviews text against the guardrails; a parameter tuner
      that reads the `tune_params.py` report). Log the impact.
      Done 2026-11-17: `.kiro/agents/wording-guardian.md`; first run on the video script, EDL and README
      found 14 issues the word-list test passes; 9 fixed, 5 are owner questions (usage log row).
- [x] C11 Browser MCP server in `.kiro/settings/mcp.json` (verify the current
      package name); check the game on a narrow viewport. Log findings.
      Done 2026-11-17: `@playwright/mcp` 0.0.85 (Microsoft, Apache-2.0), headless Edge at 390x844, on the
      public site. Pass: canvas draws (WebGL), Start takeoff and Space work, Skip is 44 px and ends the
      lead-in, all 7 gate buttons are 44 px, key V and the 2D toggle switch both ways, 0 console errors or
      warnings. Findings: at gate 1 the buttons start at y 900 on an 844 px screen and the page does not
      scroll to them (a 180 px scroll shows them all with the 3D view still visible); after that scroll the
      3D view covers the top 5 px of the gate heading. Screenshots in `data/mcp-playwright/c11-*.png`.
      Still not checked: a real phone by a human.
      Revision b scope (task 20.1): the check covers the cockpit 3D view, not only the 2D
      game, at 390x844: the cockpit canvas is not blank, the panel text and the gate buttons
      (44 px) are reachable, the start and skip buttons work, key V and the 2D toggle work,
      no console errors. Status 2026-11-14: not done; `.kiro/settings/mcp.json` does not
      exist. The headless Edge runs in `docs/screens/15.6-*390x844*` came from
      `tools/layout_check.mjs`, not from an MCP server, so they do not count for C11.
      Nothing has been checked by a human on a real phone.
- [x] C12 One Kiro power relevant to the stack; keep it only if it changed something.
      Done 2026-11-18: BrowserStack power, Device Control on a real Samsung Galaxy S25 Ultra (SM-S938B,
      Android 15, Chrome; viewport 384 x 697 CSS px). Found a bug the 390 x 844 Playwright check missed: after
      the climb, Continue sat at page y 703, below the 697 px fold (the one-scroll reveal ran only at gates).
      Fixed in `gate-panel.js` (`reveal()` also at the climb hand-over); second session passed: auto-scroll
      144 px after the climb, gate 1 shows the 3D view (416 of 419 px), all 7 buttons and the gate panel. Kept.
- [x] C13 Log at least one real property-test counterexample (task 2.6 or 5.3).
      Done 2026-11-17, outside tasks 2.6 and 5.3 (those found none): `tests/test_caption_properties.py` CAP-3
      (at most two caption lines of 42 characters) failed on the unchanged caption splitter. Hypothesis shrank
      it to `'a. a aaaaaaaaaaaa aaaaaaaaaaaa aaaaaaaaaaaa aaaa aaaa aaaaaa aaaaaaaaaaaa.'` (3 lines): a sentence under
      30 characters was always merged into the next one. The real script failed too (n1; the rough cut had 3- and
      4-line captions). Fixed in `tools/video/make_narration.py` (`caption_parts`); log in
      `docs/screens/c13-hypothesis-before.txt`.
- [x] C14 Keep `docs/kiro-usage-log.md`: one row per completed task.
      Kept: 110 dated rows on 2026-11-17. Keep adding rows until submission.

## Presentation

- [ ] C15 Video, recorded after the system is complete: English AI voice,
      captions, under 3:00, public on YouTube, shows the app running, no
      third-party logos or music (no CIRA or NOAA screenshots). Check that the
      voice service allows public use.
      Revision b: record KJFK-KBNA with the 3D cockpit (takeoff, climb, cruise, a gate,
      anti-ice, the report). KDEN-KLAX is not used in the video: it keeps the flat-ground
      Why card and its altitude block is unchanged, so it is a playable case, not the demo.
      The game note stays visible in the shot. Say that the ground is flat and frame rates
      were measured on one laptop only.
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
      Note (2026-11-17, official rules): this bonus needs a Kiro Crew app, its own public GitHub
      repo and a write-up of its features. This repository (first commit 2026-11-11) meets the
      "newly created" rule for the main entry, but Cloud Dive is not a Kiro Crew app, so it does
      not count here.

## Submit (Dec 3)

- [ ] C21 Final check: Pages site up and kept up through **Jan 29 2027**, free and
      without login; Apache-2.0 visible in the repository About section; `/.kiro`
      present and not ignored; all tests pass; draft saved; submitted by Dec 3
      KST evening.
      Status 2026-11-17: Pages serves Cloud Dive (workflow run 44061570151, checked in a browser:
      ready screen, 3D canvas, no script errors); repository public, Apache-2.0 detected by
      GitHub; `/.kiro` tracked. Still open: tests on the final commit, the draft, the submit.