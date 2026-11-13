# WeatherPath reuse audit

Checked 2026-11-13 against `C:\Users\I7-JIN\PycharmProjects\hackerton_2026`
(WeatherPath). This is evidence for `docs/Preexisting_Work_Disclosure.md`
(checklist C4). The owner confirms every row.

## Method and limits

- Line overlap: every tracked `.py`, `.js`, `.html`, `.css` file in this
  repository, compared with 908 WeatherPath files (131,945 distinct lines of
  at least 30 characters; comments, imports and docstring markers ignored).
- Function overlap: same-name functions of at least 6 lines compared with
  7,570 WeatherPath functions (similarity of normalised source).
- Both are lower bounds. They miss code that was rewritten under different
  names, and they cannot see reuse of an idea or a data format.

## Copied or nearly copied (disclose as WeatherPath code)

| Repository file | Item | Evidence |
|---|---|---|
| `src/analysis/cloud_base.py` | `noh_cloud_base_km`, `night_cloud_water_gm2` | 100 percent identical to `satellite_cross_section.py` |
| `src/analysis/cloud_base.py` | `apparent_latlon` (parallax) | 92 percent, `satellite_cross_section.py` |
| `src/analysis/cloud_base.py` | `solar_zenith_deg` | 100 percent, `gk2a_cloud.py` |
| `src/analysis/cloud_base.py` | Noh Table 1 and 2, night median cloud water, night thickness tables | file line overlap 84 percent. The Noh tables come from Noh et al. (2017). The night tables are WeatherPath's own results (EarthCARE-derived according to the source comments). |

## Adapted (rewritten, same method)

| Repository file | Item | Evidence |
|---|---|---|
| `src/analysis/cloud_base.py` | `estimate_base` | reorganises the branch logic of `_column` in `satellite_cross_section.py`; no same-name function |
| `src/analysis/icing_profile.py` | `_pixel_for` (iterative parallax lookup), `_latlon_to_rc` (Mercator rows) | 37 and 21 percent similar to `satellite_cross_section.py` and `cloud_struct.py` |
| `tools/collect_ifs.py` | index-based GRIB range selection | header comment names `ecmwf_highres.py` and `tools/ecmwf_highres/archive.py`; 8 percent line overlap |

## Depends on WeatherPath without copying code

| Repository file | Dependency |
|---|---|
| `src/integration/gk2a_cloud.py` | reads WeatherPath's projected GK-2A cache format (field names, schemas 2-4, 500x620 grid, KO bounds); 6 percent line overlap |
| `tools/import_weatherpath_ctps.py` | imports WeatherPath modules at run time and reads its raw archive; not self-contained |
| `data/overlay/gk2a_l2/` (git-ignored) | frames derived from the WeatherPath archive |

## No copy found

Line overlap of 7 percent or less and no same-name function above 40 percent:
`src/api/*`, `src/integration/goes_cloud.py`, `meteosat_cloud.py`,
`himawari_cloud.py`, `ifs_grid.py`, `flight_lookup.py`, `src/analysis/route_weather.py`,
`tools/collect_goes.py`, `collect_himawari.py`, `export_route_demo.py`,
`validate_ifs_icing.py`, `frontend/*`, `static/viewer.js`, `static/route-demo/*`,
`tests/*`. Zero overlap: `route_sampler.py`, `satellite_router.py`,
`aircraft_performance.py`, `ifs_bbox.py`, `tests/test_pacific_coverage.py`.
`static/styles.css` shares 4 short lines with WeatherPath `style.css`
(colour tokens); confirm whether that is coincidence.

## Authorship evidence from git

- The Claude branch's first commit `10298ce` ("wip: import uncommitted global
  satellite draft") contains `goes_cloud.py`, `meteosat_cloud.py`,
  `satellite_router.py`, `tools/build_airports.py` and `icing_profile.py`
  identical, line for line, to the draft written in the Kiro session
  (preserved in `stash@{0}`). Claude then corrected and extended them in
  `b9f3d82` to `908210e`. Origin: Kiro draft, then Claude.
- The backend that existed before the Kiro commit `257f7d8`
  (`gk2a_cloud.py`, `cloud_base.py`, `route_sampler.py`, `route_weather.py`,
  `aircraft_performance.py`, `route_review.py`, `flight_lookup.py`,
  `ifs_grid.py`, original `icing.py`, tests, tools) was written by another
  agent, Codex or Claude. Git does not say which; the owner specifies per file.
- Codex branch `codex/kiroween-route-demo` (`6df6f98`, `32c93f5`) holds the
  route comparison demo, which leaves the submission scope (decision W2).
- The WeatherPath repository has no license file at its HEAD (earlier
  inventory). The owner is the author and confirms that the copied parts can
  be published under Apache-2.0.

## What the US game keeps

| Keep | Reason |
|---|---|
| `cloud_base.py`: Noh base, parallax, solar zenith | Needed for GOES cloud base and daytime test |
| Night tables in `cloud_base.py` | Not needed: cases are daytime only. Recommend removing the night path from the submission build, or marking it legacy. |
| `gk2a_cloud.py`, `import_weatherpath_ctps.py`, `data/overlay` | Not needed for US cases; mark legacy |