# AeroIcing Watch — Kiroween submission notes

[Public demo](https://jinkooy.github.io/AeroIcing-Watch/) · [Source repository](https://github.com/jinkooY/AeroIcing-Watch)

## Project description

AeroIcing Watch helps a dispatcher review how forecast winds and route geometry affect estimated cruise time and fuel. The demo compares two illustrative Incheon–Haneda paths under identical cruise assumptions. Select a segment to inspect the forecast wind, ground speed, temperature, relative humidity and estimated time of passage. The app shows the forecast cycle, validity window and local bundle availability for the replay.

The bundled case uses archived ECMWF IFS 0.25° forecasts and OpenAP 2.4. A provisional temperature and relative-humidity screen was evaluated on 49 direct-route segments and 52 waypoint-route segments. Zero segments met the criterion in this case. Icing accuracy is unevaluated and contemporaneous satellite context is unavailable. Fuel values are level-cruise model estimates for assumed inputs.

Proposed category **Frankenstein** combines an archived numerical forecast, a performance model and an evidence-linked route comparison in a browser.

## Run and reproduce

1. Run `python -m http.server 8080 --bind 127.0.0.1 --protocol HTTP/1.1 --directory static/route-demo` from the repository root. Open [localhost:8080](http://localhost:8080/) and select segments on both routes.
2. See [IFS route evaluation](IFS_Route_Evaluation.md) for the forecast cycle, assumptions, and procedure used to generate the archived route responses. From a directory containing the two archived request and response pairs, regenerate the public scenario with `python tools/export_route_demo.py <archive-directory>`. The exporter uses selected fields from the archived responses. Local forecast caches remain external to the static deployment.
3. Serve the contents of `static/route-demo` as the public site root. For GitHub Pages, select **GitHub Actions** as the Pages source and run **Publish route comparison demo** from the default branch once the workflow is merged. Test the resulting URL in a signed-out browser. Confirm that the HTML, stylesheet, JavaScript and scenario JSON all load over HTTPS and that route and segment controls work on a narrow viewport.

Weather data attribution and license are shown in the demo. The underlying public forecasts are from the [ECMWF Open Data dataset](https://www.ecmwf.int/en/forecasts/datasets/open-data). AeroIcing Watch sampled and interpolated them along illustrative routes.

## How Kiro was used

Kiro IDE helped develop the satellite cross-section workflow. The local session history records successful writes to the requirements, design, tasks and steering files, and to the browser form and cloud-profile analysis. It also records edits to the icing API. The repository preserves the [spec and steering files](../.kiro/) and the [initial backend change](https://github.com/jinkooY/AeroIcing-Watch/commit/257f7d8). Codex developed the archived route comparison page, the public scenario exporter and the Pages workflow in a later pass.

## Recorded demo

The 68-second capture shows the deployed app and includes English captions.

| Time | Screen recording |
|---|---|
| 0:00–0:23 | Compare the route estimates under the same cruise assumptions. |
| 0:23–0:42 | Select a chart point and inspect the associated segment and weather. |
| 0:42–1:08 | Review forecast provenance, screening results, and the public demo URL. |

## Submission status

- [x] Confirm the public app URL and test it signed out.
- [x] Confirm the public GitHub repository, Apache-2.0 license and root `.kiro` directory.
- [x] Verify the described Kiro spec and implementation work against local session activity.
- [ ] Document any pre-existing work incorporated into the entry, including WeatherPath-derived components, and confirm third-party data and asset rights.
- [x] Record and verify the public demo video.
- [ ] Upload the video to YouTube and add its public URL to Devpost.
- [ ] Complete the English Devpost submission and confirm the category against the [official rules](https://kiroween.devpost.com/rules).
