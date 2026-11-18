<!-- Drafts for C19 (Social Blitz). The post must START with the hashtag and say your favourite thing about Kiro
     and how it changed your approach. Post during the submission period, then put the URL in the Devpost form.
     Replace [VIDEO] after the YouTube upload. -->

## X (under 280 characters)

#KiroweenHackathon26 My favourite part of Kiro: steering + hooks. I set up the science wording rules once, and a hook is set to test them on each save. Cloud Dive: fly a real cloud day (GOES + ECMWF), lowest game fuel cost wins (illustrative).
https://jinkooy.github.io/AeroIcing-Watch/

## LinkedIn

#KiroweenHackathon26

My favourite thing about Kiro is steering combined with hooks.

I built Cloud Dive for Kiroween 2026: a browser game where you fly real cloud days, for example New York to
Nashville, using GOES satellite cloud data and an ECMWF forecast. At each gate you choose lane, altitude and
anti-ice. The lowest game fuel cost wins (illustrative). Costs are illustrative game values.

The hard part was honesty. A satellite sees only the cloud top, and a forecast rule is not an observation. So I
put the wording rules into one steering file. Kiro loads it whenever game code is open, a hook is set to run
the wording test on each game-file save, and a custom agent reviews the prose the test can't scan.

How it changed my approach: I stopped re-checking my own wording by hand. The rules became checks, and later
changes became spec requirements before any code.

Play free: https://jinkooy.github.io/AeroIcing-Watch/
Code: https://github.com/jinkooY/AeroIcing-Watch
Video: [VIDEO]
