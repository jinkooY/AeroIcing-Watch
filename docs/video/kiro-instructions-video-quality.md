# Kiro 지시서: 제출 영상 품질 개선 (video quality 1, 2026-11-16)

대상: `tools/video/`(새 스크립트 3개와 기존 `make_narration.py`), `static/cloud-dive/`(영상 모드만),
`docs/video/storyboard.md`, `docs/video/edl.json`(새 파일), `.kiro/specs/cloud-dive/tasks.md`(새 그룹 22),
`docs/pending-items.md`, `docs/kiro-usage-log.md`.
기준: `docs/video-guide.md` 2장과 6장, `docs/video/storyboard.md`, `.kiro/specs/cloud-dive/submission-checklist.md` C15,
`.kiro/steering/science-guardrails.md`.

## 0. 작업 원칙

- 게임 규칙, 엔진, 비용, 증거 판정은 바꾸지 않는다. `engine.js`, 케이스 파일, `src/` 는 건드리지 않는다.
  게임 코드 변경은 2장의 영상 모드(`?video=1`)뿐이고, 이 매개변수가 없으면 화면이 지금과 한 픽셀도 달라지지 않아야 한다.
- 영상 모드는 기능 동결(2026-11-28) 전에 끝낸다. 실제 녹화와 최종 편집은 동결 뒤 최종 빌드로 한다.
  이번 작업에서는 도구를 만들고, 현재 빌드로 시험 녹화와 시험 편집까지만 한다.
- 숫자와 게이트 위치는 짐작하지 않는다. `node tools/video/gate_plan.mjs --json` 출력만 쓴다.
- 화면 문구와 자막은 `tests/test_wording.py`의 금지어를 통과해야 한다. 새로 만드는 그래픽 문구도 같다.
- 제3자 로고, 제3자 음악, CIRA·NOAA 화면 캡처는 쓰지 않는다. 효과음은 스크립트로 직접 합성한 것만 쓴다(9장 P-23, 오너 결정).
- 커밋하지 않는다. 이 파일들은 지금 `main` 체크아웃에 untracked 상태다. 커밋은 오너가 브랜치에서 한다.
- 9장 항목은 오너 결정이다. 진행하지 말고 `docs/pending-items.md`에 적는다.

## 1. 지금 영상의 문제 (data/video/animatic-estimated.mp4 기준)

측정한 사실만 적는다.

| 항목 | 상태 | 원인 |
|---|---|---|
| 오디오 | 영상 스트림 1개뿐, 오디오 트랙 없음 | `make_animatic.py`가 무음 애니매틱만 만든다. 내레이션은 h, p, g1-g8만 있고 n, r, d, k, c 줄은 합성 전(P-20, 무료 한도) |
| 움직임 | 165초 전체가 정지 화면 24장. md5가 같은 프레임 묶음: 4장(07-10, 약 28초), 3장(04-06), 2장 묶음 3개 | 실제 녹화 전이라 `docs/screens/21.10-*` 스틸을 재사용 |
| 핵심 장면 누락 | n3, g3가 "Observed supercooled layer"를 말하는 동안 화면은 게이트 1(Possible)의 방빙 화면 | 500 km Observed 게이트(storyboard 3장 gate 5) 스틸이 없음 |
| 리포트 | 화면 제목이 "$1,034 more than Straight-ahead", "Saving share ... -454 percent" | 21.10 리포트 스틸이 데모 계획이 아닌 실패 비행에서 찍힘. 데모 계획은 $3,312(Best + $38) |
| 3D 가독성 | `base estimated` 라벨이 1080p에서 약 10-14 px, 구름이 흰 직사각형, 안개로 장면 대비가 낮음 | 게임 기본 화면 크기 기준 디자인. 영상은 휴대폰에서도 본다 |
| 빈 장면 | k1, k2b, k3b, c1, c2가 "placeholder: not recorded yet" 카드 | T7, T8 미녹화 |
| 인코딩 | 25 fps, 211 kbps, 왼쪽 위 "ANIMATIC" 띠 | 애니매틱용 설정. 최종본에는 쓰지 않는다 |

결론: 화면 연출보다 제작 방식이 문제다. 정지 화면 슬라이드쇼를 **실제 플레이 녹화 + 자동 편집**으로 바꾼다.

## 2. 작업 A: 녹화용 영상 모드 `?video=1` (게임 코드, 동결 전)

`tasks.md`에 그룹 22 "(i) Video capture mode"를 추가하고 하위 작업으로 진행한다. requirements에는
R12(Submission package)에 한 줄을 추가한다: "`?video=1` 은 녹화용 표시만 바꾸고, 엔진 입력과 출력은 바꾸지 않는다."
P-22(9장)가 승인된 뒤 시작한다.

`?video=1` 일 때만 적용한다 (`document.body.dataset.video = "1"` 과 CSS `body[data-video="1"] ...` 로 구현):

- A1. 글자 크기: 3D 장면 라벨(`base estimated`, `Top of climb`, 게이트 라벨 타일)은 1920x1080 캔버스에서 최소 28 px,
  HUD 칩 값은 최소 26 px. 버튼 줄과 패널 제목은 1.25배.
- A2. 숨김: 오른쪽 아래 단축키 버튼 줄(2D view, Chase view, Legend, Why?, Sources)과 차선 정보 바
  ("Lane 3 of 5 | 10 km | head-wind ..."). **하단 game note 와 출처 줄(GOES-19 시각 UTC 포함)은 숨기지 않는다** (video-guide 2장).
- A3. 구름 상자: 흰 불투명 직사각형 대신 반투명(불투명도 0.55-0.7)과 가장자리 페이드. 증거 등급 색과 해치는 그대로 둔다.
  색 대비 검사가 `tests/`에 있으면 통과해야 한다.
- A4. 안개 거리: 영상 모드에서만 안개 시작 거리를 늘려 앞 구름이 더 또렷하게 보이게 한다. 값은 시험 녹화를 보고 정한다.
- A5. 커서 숨김(`cursor: none`)과 hover 효과 끄기. 녹화 스크립트가 클릭을 보낼 때 커서가 화면에 남지 않게 한다.
- A6. 연출용 무작위(흔들림, 성에 무늬)가 `Math.random`을 쓰면 `?video=1&seed=<n>` 으로 고정 시드를 쓴다. 같은 take를 다시 찍어도
  같은 화면이 나와야 편집 EDL을 재사용할 수 있다. 판정과 비용에는 무작위가 원래 없으므로 손대지 않는다.

시험:
- `node tools/layout_check.mjs` 결과가 영상 모드 추가 전과 같다(매개변수 없을 때 변화 없음).
- 새 검사 `tools/video/video_mode_check.mjs`: `?video=1` 에서 game note 와 출처 줄이 보이고, 라벨 글자 크기가 A1 기준 이상이고,
  콘솔 오류가 없다. `tools/browser_guard.mjs`를 쓴다.
- `pytest -q tests/test_wording.py` 통과.

## 3. 작업 B: 자동 녹화 `tools/video/record_takes.mjs`

손으로 OBS를 조작하지 않는다. 케이스가 결정론적이므로 입력을 스크립트로 보내면 같은 take를 몇 번이든 다시 찍을 수 있다.
Playwright는 이 저장소에 없다. 기존 `tools/browser_guard.mjs`(Node 내장 모듈과 설치된 Edge만 사용)를 확장한다.

- B1. `browser_guard.mjs`에 옵션 추가: `headless: false`, `windowSize: "1920,1080"`, `app: <url>`(주소창 없는 창),
  `--force-device-scale-factor=1`, `--hide-scrollbars`. 기본값은 지금과 같게 둔다(다른 검사 스크립트가 영향받지 않게).
  잠금 파일, 한 프로세스, 타임아웃 규칙은 그대로 따른다. 녹화는 길어서 `--timeout=900` 을 쓴다.
- B2. 화면 캡처: `ffmpeg -f gdigrab -framerate 60 -i title="<창 제목>"` 으로 브라우저 창만 잡는다.
  창 제목은 페이지 `<title>`에 take id를 붙여 고유하게 만든다. 중간 파일은 `-c:v libx264 -crf 12 -preset veryfast -pix_fmt yuv420p`.
  저장 위치 `data/video/takes/<take>.mp4` (git-ignored).
- B3. 입력: CDP `Input.dispatchKeyEvent` 와 `Input.dispatchMouseEvent`. take 정의는 `tools/video/takes.json`에 둔다.
  T2(데모 비행)의 게이트별 동작은 `gate_plan.mjs --json` 출력에서 만든다(storyboard 3장 표: 게이트 1에서 ArrowUp x3, A, Continue ...).
  게이트 도착은 시간으로 기다리지 말고 페이지 상태(패널 제목 "Decision gate", 게이트 km)를 폴링해서 기다린다.
- B4. 마커: 스크립트가 동작할 때마다 녹화 시작 기준 시각을 `data/video/takes/<take>.markers.json`에 쓴다.
  예: `{"t": 23.48, "event": "gate", "km": 500, "n": 5}`, `{"t": 25.10, "event": "key", "key": "V"}`. 편집(4장)은 이 마커로 자른다.
- B5. 녹화할 take: storyboard 2장의 T1, T2, T3, T4, T5, T8의 게임 부분(game note). T6은 그래픽, T7은 Kiro 화면이라 제외(7장).
  T2 리포트는 반드시 데모 계획 비행에서 나온 것이어야 한다. 리포트 제목이 "more than Straight-ahead"이면 그 take는 실패로 처리하고
  종료 코드 1로 끝낸다. 기대값: 총 $3,312, Best보다 $38 위(gate_plan 재계산값이 기준).
- B6. 품질 검사: 녹화 직후 `ffprobe`로 프레임 수 / 길이를 계산해 평균 57 fps 미만이면 경고하고 다시 찍는다.
  GPU가 없는 환경이면 프레임이 떨어지므로 `--gpu=hw` 를 기본으로 한다.
- B7. 사용법을 파일 머리 주석에 쓴다: `node tools/video/record_takes.mjs --take=T2 [--timeout=900]`.

대체 경로: gdigrab가 프레임을 떨어뜨리면 OBS로 녹화하되 입력은 같은 스크립트로 보낸다(`--no-capture`). 마커는 그대로 쓴다.

## 4. 작업 C: 편집 파이프라인 `tools/video/make_final.py` 와 `docs/video/edl.json`

`make_animatic.py`는 그대로 둔다(타이밍 점검용). 최종본은 새 스크립트로 만든다.

- C1. `docs/video/edl.json`: 대본 줄 id마다 화면 하나를 정한다.
  필드: `line`, `take`, `in`(마커 이름 또는 초), `speed`(빨리감기 배율, 기본 1), `zoom`(시작과 끝 사각형, 픽셀),
  `highlight`(강조 박스 사각형과 나타나는 시각), `text`(화면 문구, storyboard 4장 "On-screen text"), `transition`(cut 또는 fade).
  storyboard 4장 표를 그대로 옮긴다. 예: g3는 T4의 라벨 "Observed supercooled layer at planned altitude" 로 줌인 후 밑줄.
- C2. 길이는 내레이션 실측 타임라인(`make_narration.py`가 쓰는 timeline JSON)에서 가져온다. 화면 길이가 줄 길이보다 짧으면
  마지막 프레임을 늘리지 말고 오류를 낸다(정지 화면 방지). 한 화면이 6초를 넘으면 줌이나 컷을 넣으라고 경고한다.
- C3. 영상 처리(ffmpeg filtergraph): 줌과 팬은 `crop` + `scale`(lanczos)을 시간 보간으로, 빨리감기는 `setpts`,
  장면 전환은 `xfade` 0.3초, 강조 박스와 밑줄은 `drawbox`, 화면 문구는 PNG로 만들어 `overlay`(폰트는 시스템 Segoe UI, 로고 없음).
  "ANIMATIC" 띠는 넣지 않는다.
- C4. 자막: SRT를 ASS로 바꿔 영상에 입힌다. 글자 46 px, 흰 글자에 검은 외곽선 3 px, 아래 여백 150 px
  (하단 game note 와 출처 줄을 가리지 않게). 같은 SRT를 YouTube 업로드용으로도 따로 낸다.
- C5. 오디오: 줄별 wav를 타임라인대로 이어 붙이고, 앞뒤 무음 정리(`silenceremove`, 0.05초 남김),
  `loudnorm=I=-14:TP=-1.5:LRA=11`, 48 kHz 스테레오, AAC 192 kbps. 효과음은 P-23 결정 전까지 넣지 않는다(옵션 `--sfx`).
- C6. 최종 인코딩: H.264 High, 1920x1080, 60 fps, CRF 18, `yuv420p`, `-movflags +faststart`. 출력 `data/video/cloud-dive-final.mp4`.
- C7. 검사: 길이 3:00 미만(목표 2:50 전후), 오디오 트랙 있음, 정지 구간(`freezedetect=n=0.001:d=4`) 0개 —
  T5 리포트 표처럼 의도한 정지는 EDL에 `"hold": true` 로 표시한 것만 허용.
  결과를 `data/video/cloud-dive-final.report.json`에 쓴다.
- C8. 시험: `tests/test_make_final.py`. ffmpeg 호출 없이 EDL 검증(모든 줄 id가 `script.json`에 있음, 마커 이름이 존재함,
  6초 경고, 화면 문구의 금지어 검사)과 filtergraph 문자열 생성만 시험한다.

## 5. 작업 D: 장면 구성 개선 (storyboard 수정)

storyboard 4장 표에 반영하고, 7장에 "Video quality 1 (2026-11-16)" 절로 변경점을 적는다.

- D1. 데이터 구간(1:36-2:08): 텍스트 상자 다이어그램만 32초 보여 주지 않는다. `make_route_graphics.py` 결과
  (`route-sat.png`, `route-evidence.png`, `route-anim.mp4`)를 d1, d2에 쓰고, 다이어그램 단계 그림은 d3, d4에 키워드 단위로 나타나게 한다.
  d5는 디스패처 단면도 실제 화면 3초.
- D2. 리포트 비교 그래픽: 리포트 값(Best $3,274, 데모 비행, Straight-ahead $3,502, Wasteful $13,533)을 막대로 보여 주는
  애니메이션 그림을 `tools/video/make_report_bars.py`로 만든다. 값은 녹화한 T5 리포트와 `gate_plan.mjs --json`에서만 가져온다.
  Wasteful 막대는 축을 끊어 표시하고 "reference only"를 쓴다. r2 뒤 3초.
- D3. 강조 순간: n2(고도 9,000 → 12,000, Anti-ice Off → On)와 g5(얼음 지수 상승, 비용 칩 증가)는 HUD 칩에 줌인한다.
  EDL `zoom` 으로 처리한다.
- D4. 훅(0:00-0:11)은 지금 storyboard대로 T3 성에 장면으로 시작한다. 첫 2초 안에 장면이 움직여야 한다.

## 6. 작업 E: 내레이션 마무리 (P-20 결정 뒤)

- E1. 모든 줄을 **한 모델, 한 목소리**로 다시 만든다. 지금 `data/video/Charon/`과 `data/video/Charon-3.8-flash-lite-tts/` 두 폴더가 섞여 있다.
  오너가 고른 목소리 하나로 `make_narration.py --voice <name>` 을 돌린다.
- E2. 무료 한도에 걸리면 멈추고 남은 id를 보고한다. 재시도 반복으로 한도를 소모하지 않는다.
- E3. `make_narration.py`의 B1 규칙(빠진 클립이 있으면 전체 WAV를 쓰지 않음)을 유지한다.

## 7. 작업 F: Kiro 장면(T7)과 마무리(T8) 녹화 준비

Kiro IDE 화면은 오너가 직접 찍는다. Kiro는 준비물만 만든다.

- F1. `tools/video/capture_window.ps1`: 창 제목을 받아 `gdigrab` 60 fps로 녹화하고 Ctrl+C로 멈춘다(3장 B2와 같은 인코딩 설정).
- F2. `docs/video/t7-shotlist.md`: storyboard 6장의 1-5번 화면을 순서, 길이, 열 파일, 스크롤 위치로 적는다.
  P-18이 승인되면 6번을 추가한다: `static/cloud-dive/` 파일 문자열에 `safe`를 넣고 저장 → `wording-on-cloud-dive-save` FAIL →
  되돌리고 저장 → PASS. 녹화 직후 파일이 원래대로인지 `git diff --stat` 으로 확인하는 단계를 포함한다.
- F3. 녹화 전 정리 체크: 알림 끄기, 다른 탭과 북마크 바 숨김, 편집기 테마와 글자 크기(1080p에서 18 px 이상), 개인 정보(이메일, 사용자 경로)가
  화면에 없는지.

## 8. 실행 순서

1. 작업 A(영상 모드) → P-22 승인 뒤, 동결 전 필수.
2. 작업 B(녹화) → 현재 빌드로 T2 시험 녹화 1회.
3. 작업 C(편집) → 지금 있는 내레이션 클립과 시험 take로 30초 시험 편집(h1-p2). 결과를 오너에게 보여 준다.
4. 작업 D(storyboard, 그래픽).
5. 작업 E, F는 오너 결정 뒤.
6. 동결 뒤: 최종 빌드로 `gate_plan.mjs` 재계산 → 전체 take 녹화 → `make_final.py` → video-guide 6장 점검.

## 9. 오너 결정 필요 (진행하지 말고 `docs/pending-items.md`에 추가)

- P-22. 영상 모드(`?video=1`)를 동결 전에 게임에 넣을지. 화면 표시만 바꾸지만 게임 파일 변경이다.
- P-23. 직접 합성한 효과음(비용 칩 증가, 게이트 정지)을 넣을지. video-guide 5장 7번은 "직접 만든 것만"을 허용한다.
- P-24. 자막을 영상에 입힐지(권장)와 YouTube SRT를 함께 올릴지.
- 기존 P-18(Kiro 장면 길이), P-19(공개 URL, 엔드 카드), P-20(음성 약관과 목소리)은 이 작업의 E, F와 엔드 카드에 필요하다.
  상태를 바꾸지 말고 이 지시서를 참조로 덧붙인다.

## 10. 완료 기준

1. `?video=1` 이 A1-A6을 만족하고, 매개변수 없이 `node tools/layout_check.mjs` 결과가 전과 같다.
2. `node tools/video/record_takes.mjs --take=T2` 가 사람 손 없이 끝나고, 리포트가 데모 계획 값(gate_plan 기준)이며, 평균 57 fps 이상이다.
3. `python tools/video/make_final.py --until p2` 시험 편집본에 오디오 트랙, 입힌 자막, 줌 1회 이상이 있고 4초 이상 정지 구간이 없다.
4. `pytest -q tests/test_make_final.py tests/test_make_narration.py tests/test_wording.py` 통과(WeatherPath 환경).
5. storyboard 4장과 7장, `edl.json`, `takes.json`이 서로 맞다.
6. `tasks.md` 그룹 22와 `docs/kiro-usage-log.md` 본 표에 이 작업 행이 있다(Kiro로 실제 한 작업만).
7. 9장 P-22-P-24가 `docs/pending-items.md`에 있다.
8. 커밋하지 않았다.
