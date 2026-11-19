# Blender for the Cloud Dive video: what the earlier tools give us (assessment, 2026-11-16)

Earlier tools (read only, not changed): the owner's earlier, unpublished Blender scripts (another project, local, not in this repository): a still-cut script, a motion and
frames script, a compositing script (rain, fog drift, HUD, seamless loop) and an encoder script.
Blender 4.5.9 is installed for this user at `%USERPROFILE%\.cache\weatherpath-blender\blender-4.5.9-windows-x64\blender.exe`
(Cycles on the RTX 3060 Ti through OptiX works). System ffmpeg is now available too, so the Blender encoder script is not needed.

| Part of the earlier tools | Use here | Why |
|---|---|---|
| Cycles volume cloud (noise density, vertical profile) | **Reuse, changed** | Same idea. Heights now come from the case file (maps made by `prepare_cloud_maps.py`) instead of hand placed boxes |
| Mist-pass fog in the compositor | Not used | Mist does not see volumes; clouds are volumes. Haze is a finite volume box instead |
| World sky | **Reuse, changed** | Physical sky (Nishita) at an assumed afternoon sun. A world volume must not be used (infinite haze turns the sky black; found while testing) |
| Camera rig along a path, linear keyframes | **Reuse** | Flight along the route at the planned altitude |
| Models, rain and an overlay HUD of the other project | Not used | Not part of Cloud Dive. The real HUD comes from the game recording |
| Seamless loop cross-fade | Not used | Our shots are not loops |
| PNG frames to mp4 inside Blender | Replaced by ffmpeg | ffmpeg is installed now |

What the data says about the picture (KJFK-KBNA, lane 3, 12,000 ft): between 340 and 640 km the satellite cloud tops are about
8,600 to 16,000 ft and the bases 3,800 to 8,000 ft. The planned altitude therefore skims the top of a stratiform deck: clear
and above the tops at about 440 km (Not indicated), inside the top layer from about 480 km (the Observed block). That is a good
shot: flying over a cloud sea, then dipping into it.

New files (this repository): `tools/video/blender/prepare_cloud_maps.py` (numpy and Pillow, runs in any Python),
`tools/video/blender/cloud_dive_clouds.py` (runs inside Blender). Outputs go to `data/video/blender/` (git-ignored).

Honesty rules for these images (science guardrails): they are an illustration of satellite cloud tops and the case's base
estimate on five lanes, with procedural detail between them. Where the base is unknown a thin faded cap is drawn, never an invented
base. No evidence level, no severity word and no suggestion is drawn. The video caption says "Illustration from satellite cloud-top data".

First results (still frames, 960x540 to 1280x720): the cloud deck, haze and sky render correctly; the look is still soft and low in
contrast (a smooth stratus sea). Render time on this machine: about 5 s a frame at 960x540 with 32 samples, about 15 s at 1280x720
with 48 samples; at 1920x1080 about 35 s, so a 6 s shot at 24 fps is about 80 minutes.

Next: lift the contrast and the crispness of the tops (higher frequency lumps, thinner top fade, stronger sun and shadow), choose the
two shots (approach over the tops at 430 to 470 km, and the dip into the top layer at 470 to 500 km), then render them.

Tuning (2026-11-16, stills u1 to u5 at s = 452 km): the soft, blurry look came from the ray-march step. The volume box is 160 km
long, so Cycles' automatic step was hundreds of metres and smeared every edge. A step rate of 0.1 (new option `--step-rate`, now
the default) gives crisp cumulus tops, billows on the horizon and natural gaps in the deck. Other defaults changed with it:
density 0.12, towers 1,400 m, valleys 900 m, haze 0.7e-6, pitch -12, sun elevation 15 (9 gave a sepia cast), sun intensity 4.5,
exposure -4.6. Cost: about 60 s a frame at 1280x720 with 64 samples, so about 2.3 min at 1920x1080. A 6 s shot at 24 fps
(144 frames) is about 2.4 h at 720p or 5 to 6 h at 1080p.

Preview renders (2026-11-17, 640x360, 24 samples, 12 fps upsampled to 24, 6 s each, about 10 min a shot; `tools/video/blender/render_previews.ps1`):
- Data check, lane 3: satellite tops are 9,800 to 10,100 ft at 445 to 465 km (below the 12,000 ft flight level) and 14,571 ft from
  475 km. With the lumps centred on the satellite top, towers poked through the flight level where the data says the aircraft is
  above the tops. `--top-shift -900` (default) lowers the lumpy top so the satellite top is near its upper edge.
- Inside a deep cloud the picture went black: Cycles stops after a few volume bounces (8 was still black). `--ambient` adds a fill
  light that ramps in over 400 m below the lumpy top, and `--ambient-keys km:factor,...` switches it on only while the camera is
  inside. Used everywhere it flattened the outside view, so it is off by default.
- Shot A (approach over the tops, 440 to 466 km): `data/video/blender/anim/pv2_A_approach.mp4`. Steady, largest frame-to-frame
  brightness change 8 (of 255).
- Shot B (into the deck and out, 464 to 496 km, fill on 470 to 490 km): `pv3_B_dip.mp4`. Outside, entry, grey in-cloud, exit.
  Single-frame dips of up to 35 where the camera crosses small gaps at 450 m a frame. Final render: 24 fps and Cycles motion blur.
- B revised (2026-11-17, owner review of pv2/pv3): pv2's black in-cloud frames hurt the eyes; pv3's grey was better; the owner
  wants the inside white and no dark flicker, B slower, and the cut placement in n3. Now B is 468 to 486 km (3 km/s, was 5.3),
  fill light 5 in a near-white colour, keyed on from 471.5 km, and the encode adds `deflicker=mode=pm:size=7`. `pv4_B_dip.mp4`:
  luma 191 to 218, largest step 6, no dips (`flicker_check.ps1`). The raw frames still have two small dips (23 and 12 of 255),
  which the deflicker removes; one is a change from warm white to a cooler grey at about 473 km.
