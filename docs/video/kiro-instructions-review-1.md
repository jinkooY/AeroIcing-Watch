# Kiro 지시서: 영상 제작안(C15) 점검 결과와 수정 작업 (review 1, 2026-11-15)

대상: `docs/video/storyboard.md`, `docs/video/script.json`, `docs/video/script-ko.md`, `docs/video-guide.md`,
`tools/video/make_narration.py`, `docs/kiro-usage-log.md`의 마지막 행.
기준 데이터: `static/cloud-dive/cases/20261112-kjfk-kbna-1930z.json`, `static/cloud-dive/engine.js`,
`.kiro/specs/cloud-dive/submission-checklist.md` C15.

## 0. 작업 원칙

- 녹화는 하지 않는다. 문서, 대본, 도구만 고친다. 녹화는 기능 동결(2026-11-28) 뒤.
- 숫자와 게이트 위치는 짐작하지 않는다. 케이스 파일과 `engine.js`로 계산한 값만 쓴다.
- 대본을 고치면 `script.json`과 `script-ko.md`를 같이 고친다. 영어가 기준이다.
- 커밋하지 않는다. 지금 이 파일들은 `main` 체크아웃에 untracked 상태다. 커밋은 오너가 브랜치에서 한다.
- 4장 항목은 오너 결정이다. 진행하지 말고 `docs/pending-items.md`에 적는다.

## 1. 반드시 고칠 것: 사실 오류

### A1. 3번 차선에 30 km Observed 셀이 있다

storyboard 1장은 "3번 차선 12,000 ft의 첫 Observed는 약 380~400 km"라고 쓴다. 케이스 파일을 보면 틀렸다.

- 3번 차선(인덱스 2), 30 km(step 3)에서 8,000~12,000 ft 다섯 고도가 모두 Observed(3)다.
- 게이트 1 스크린샷 `docs/screens/21.10-gate.png`의 미니맵과 옆 단면도에 이미 주황 해치가 보인다.
- 0~130 km가 한 덩어리 결빙 구간이라 30 km에서는 entry 게이트가 생기지 않는다. 그래서 게임은 멈추지 않고,
  조종석은 이 주황 상자를 그냥 지나간다.

문제: 4장 0:31-0:39 장면은 n1("Only the forecast flags possible ice here ... Never observed.")을 말하면서
미니맵을 확대한다. 화면의 주황 해치와 대사가 충돌한다.

할 일:
1. storyboard 1장의 Observed 위치 문장을 데이터대로 고친다(30 km 한 칸, 그다음 380/390 km, 520~590 km 덩어리).
2. 3장 step 2와 4장 0:31-0:39에서 미니맵 확대를 뺀다. 라벨 타일만 확대한다.
3. n1에서 "Never observed."를 뺀다.
   새 문장: `First gate. Here only the forecast flags possible ice, so the label says: possible, forecast only.`
4. 3장 step 3 뒤에 메모를 넣는다: 30 km에서 주황 상자를 지나간다. 편집에서 잘라 내거나 화면에 보이게 둔다(4장 D4 참고).

### A2. 게이트 1 이후 순서는 아직 짐작이다. 계산으로 확정한다

`engine.js` 규칙: entry 게이트는 앞 3칸(`ENTRY_LOOKAHEAD = 3`)에 결빙 셀이 처음 들어올 때,
exit 게이트는 방빙이 켜져 있고 앞 5칸(`EXIT_LOOKAHEAD`)이 비었을 때 생긴다. 방빙이 켜진 상태에서
마지막 결빙 셀과의 간격이 5칸(`MERGE_GAP`) 미만이면 entry 게이트를 합친다.

이 규칙대로 읽으면, storyboard가 말하는 "약 380 km의 Observed 게이트"는 실제로는 약 350 km에서 멈추고
앞 3칸에 들어온 첫 셀은 370 km의 Possible일 가능성이 높다. 깨끗한 Observed 게이트는 520 km 덩어리 앞
(약 500 km)일 수 있다. 이것도 짐작이므로 계산해서 확정한다.

할 일:
1. `tools/video/gate_plan.mjs`를 만든다. `engine.js`의 `loadCase`, `initialState`, `setTargets`,
   `runUntilGate`, `lookaheadLevels`, `levelAt`, `totalUsd`만 쓴다. 화면 코드는 import하지 않는다.
2. 데모 계획을 그대로 난다: 게이트 1에서 고도 +3단계(12,000 ft)와 방빙 On, 이후 각 게이트에서
   "결빙 구간 앞이면 On, 벗어났으면 Off", 차선 유지. 비교용으로 `references.best.policy`도 출력한다.
3. 게이트마다 출력: 순번, km, reasons(entry/exit/ice), 현재 셀 레벨, 앞 3칸 레벨, 출발 상승($88.48)을 포함한
   누적 비용, 얼음 지수. 마지막에 총 게이트 수와 최종 비용.
4. 결과로 storyboard 3장 표의 km를 채우고, n3/g3에 쓸 "Observed가 앞에 보이는 게이트"를 정한다.
   8장 질문 1, 2에 답을 적는다.
5. 데모 계획의 최종 비용이 Best와 얼마나 차이 나는지 적는다. r2의 [X] 예상값이 된다(녹화본 값으로 최종 확정).

### A3. 숫자 두 개가 틀렸다

리포트는 `formatUsdWhole`(`Math.round`)로 반올림한다. 출발 상승은 `params.departureClimbUsd = 88.48`.

| 기준 | 계산 | 화면 값 | storyboard |
|---|---|---|---|
| Best | 3185.99 + 88.48 = 3274.47 | **$3,274** | $3,275 (틀림) |
| Straight-ahead | 3413.68 + 88.48 | $3,502 | 맞음 |
| Wasteful extreme | 13444.61 + 88.48 | $13,533 | 맞음 |
| 항상 방빙(12,000 ft) | 3352.40 + 88.48 | **$3,441** | $3,440 (틀림) |
| 방빙 없음 | 3473.68 + 88.48 | $3,562 | 맞음 |

storyboard 1장과 3장 끝("within about $50 of Best ($3,275)")을 고친다. 차이 $228, 약 6.5퍼센트는 맞다.

### A4. g5의 "Straight ahead"가 리포트의 Straight-ahead와 겹친다

리포트의 Straight-ahead 기준(`src/analysis/solver.py`)은 "가운데 차선, 출발 고도, 결빙 셀에서 방빙 On"이고
얼음 지수 0으로 도착한다. g5는 "Straight ahead, unprotected?"라고 말하면서 얼음이 쌓이는 장면을 보여 준다.
바로 뒤 r1에서 "Straight-ahead"가 다시 나오므로 시청자는 같은 것으로 읽는다.

할 일: g5를 `Anti-ice off, flying on? Ice builds, drag grows, and the dollars climb.`로 바꾼다.
storyboard 4장 1:11-1:16의 화면 문구도 "Different take: anti-ice off"를 유지한다.

T3 메모 추가: 얼음 지수 50에서 게임이 멈춘다(`ICE_GATE = 50`, 패널 제목 "Decision gate: ice index").
그 뒤에도 방빙 Off로 계속 가면 100에서 회항한다(`diversionUsd` 5,000). 로그 10.4 기준 KJFK-KBNA는
방빙 Off로 날면 회항한다. "50까지만 찍고 멈춘다"를 기본으로 적는다.

### A5. c1의 "Tested on one laptop"

C15는 "frame rates were measured on one laptop only"를 말하라고 한다. 테스트 전체가 아니라 프레임 속도다.
c1 마지막 문장을 `Frame rate measured on one laptop.`로 바꾼다.

### A6. T8의 "README Limits section"이 가리키는 곳이 틀렸다

README의 `## Known Limitations`는 FastAPI 위성 단면 앱의 한계다(단일 구름층, 극지 공백 등).
Cloud Dive의 한계(평평한 지면 등)는 `## Cloud Dive (the Kiroween 2026 entry)` 절, 약 242행에 있다.
storyboard 2장 T8과 4장 2:30-2:44를 이 절로 고친다.

### A7. 사용 로그에 넣은 행이 깨졌다

`docs/kiro-usage-log.md` 마지막 행(2026-11-14, C15 video)이 22.x 판정 표(4열) 안에 6열로 붙어 있다.
본 로그 표(9행 헤더: Date, Kiro feature, What was asked, Outcome, What it caught or changed, Commit)로 옮긴다.
그리고 이 작업이 실제로 Kiro에서 한 것인지 확인한다. 로그 규칙은 "Kiro 기능을 실제로 쓴 행만"이다.
Kiro가 아닌 도구로 했다면 행을 지우고 오너에게 알린다.

## 2. 도구 수정: `tools/video/make_narration.py`

### B1. 일부 클립만 있을 때 WAV와 SRT가 어긋난다

`--only`를 쓰거나 합성이 중간에 실패해서 클립이 없는 줄이 있으면, 그 줄은 타임라인에 추정 길이로 들어가지만
WAV에는 소리도 무음도 들어가지 않는다(199-203행). 그 뒤 모든 자막이 앞당겨진다.

할 일: dry-run이 아닐 때 준비된 줄 중 클립이 없는 것이 하나라도 있으면 `narration-*.wav`를 쓰지 않는다.
없는 id를 출력하고 종료 코드 1로 끝낸다. 개별 클립 합성은 그대로 둔다.

### B2. 네트워크 없는 테스트

`tests/test_make_narration.py`를 추가한다. API 호출 없이:
- `stamp`, `wrap`(42자), `cues_for`(태그 제거, 짧은 문장 합치기, 시작과 끝 시각 보존)
- B1: 클립 하나가 없을 때 WAV를 쓰지 않는다(임시 폴더, `OUT`과 `SCRIPT`를 monkeypatch).
- `script.json`의 모든 줄이 `tests/test_wording.py`의 금지어(R9.1, R9.2)에 걸리지 않는다.

## 3. 문서 정리

- C1. `docs/video-guide.md` 3장과 4장은 옛 내용이다(Observed 게이트가 먼저, 반례, 커스텀 에이전트, MCP 문장).
  맨 위에 "3~4장은 `docs/video/storyboard.md`와 `docs/video/script.json`으로 대체됨" 한 줄을 넣고
  3~4장 본문을 지운다. 1, 2, 5, 6, 7장은 남긴다.
- C2. `video-guide.md` 6장 업로드 전 점검에 두 줄 추가: "g5와 리포트의 Straight-ahead가 다른 것으로 들린다",
  "storyboard의 숫자를 녹화 당일 케이스 파일로 다시 계산했다(`gate_plan.mjs`)".
- C3. storyboard 7장(이번 단계의 대본 변경)에 A1, A4, A5 변경을 적는다. `script-ko.md` 아래 "이전 버전에서 바뀐 점"에도 같은 내용을 적는다.

## 4. 오너 결정 필요 (진행하지 말고 `docs/pending-items.md`에 추가)

- D1. Kiro 장면 길이. 지금 storyboard는 22초(2:08-2:30), C15 계획은 60초(1:30-2:30)다. Kiro 활용은 심사 항목이다.
  안: n5를 빼고 n3과 g3을 한 줄로 합쳐 약 12초를 확보해서 Kiro를 35초 안팎으로 늘린다. 늘린 시간에는
  "훅이 금지어를 실제로 잡는" 장면을 찍는다: `static/cloud-dive/` 파일의 문자열에 `safe`를 넣고 저장해서
  `wording-on-cloud-dive-save`가 FAIL을 내는 것을 찍고, 되돌려 PASS를 찍는다. 실제로 일어난 일이므로 로그에 한 행 넣을 수 있다.
  이것으로 C15의 "steering catching banned wording"을 사실대로 보여 줄 수 있다.
- D2. 공개 URL(C21). README 맨 위는 아직 인천-하네다 route demo와 그 링크를 소개한다. 로그 20.2에 따르면
  Pages 루트는 이제 Cloud Dive지만 GitHub에서 워크플로를 돌린 기록은 없다. c2와 엔드 카드의 URL, README 맨 위 절을 오너가 정한다.
- D3. 음성 서비스 약관. C15는 공개 게시 허용 확인을 요구한다. Gemini TTS(무료 등급 포함)의 생성물 공개 사용 조건을 오너가 확인한다.
- D4. 30 km의 주황 Observed 상자(A1)를 쓸지. 쓰면 비행 초반에 Observed를 바로 보여 줄 수 있어 순항 빨리감기가 짧아진다.
  다만 그 지점은 게이트가 아니므로 n3 "Next gate"와 맞지 않는다. 쓰려면 n3 문장을 다시 써야 한다.

## 5. 완료 기준

1. `node tools/video/gate_plan.mjs` 출력이 storyboard 3장 표의 km, 게이트 수, 예상 비용과 일치한다.
2. A1~A7 수정이 `storyboard.md`, `script.json`, `script-ko.md`에 반영되어 있다.
3. `python tools/video/make_narration.py --dry-run`이 경고 없이 끝나고 추정 길이가 2:55 이하다.
4. `pytest -q tests/test_make_narration.py tests/test_wording.py` 통과(WeatherPath 환경).
5. `docs/kiro-usage-log.md` 본 표에 이 작업 행이 있다(Kiro로 한 작업만).
6. 4장 D1~D4가 `docs/pending-items.md`에 있다.
7. 커밋하지 않았다.
