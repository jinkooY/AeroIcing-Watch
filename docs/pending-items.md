# 보류 항목 (소유자 지시 대기)

- 날짜: 2026-11-14
- 마지막 커밋: `bacaf3b` (origin/main에 push 완료)
- 테스트 상태: pytest 286 통과, node 238 통과, layout check ok, headless Edge 0개
- 규칙: **각 항목은 소유자 지시 후에만 착수.** 이 문서의 항목은 아직 task가 아니며, `tasks.md`에 체크박스로 넣지 않았다.
- 출처: `docs/reviews/2026-11-14-180419-cloud-dive-rev-b-c-review.md` (판정 NEEDS_CHANGES, 이슈 12건), `docs/kiro-usage-log.md` (그룹 13-21, 21.10), `.kiro/specs/cloud-dive/tasks.md` Notes, `.kiro/specs/cloud-dive/submission-checklist.md`.
- 리뷰 번호는 리뷰 문서의 이슈 번호다. 리뷰에서 #4는 skip 플래그, #5는 wiring 테스트다.

## 1. 열린 항목

범위 표기: "표시" = display code, "tools" = `tools/`, "테스트" = tests only. 모든 항목에서 engine, cost model, solver, case data는 변경하지 않는다.

| ID | 항목 | 근거 | 심각도 | 제안 조치 | 영향 범위 | 소유자 결정 필요 사항 | 상태 |
|---|---|---|---|---|---|---|---|
| P-01 | Browser guard가 SIGHUP과 외부 kill에서 브라우저를 남긴다 | 리뷰 #1, `tools/browser_guard.mjs:84-85` | 중 | SIGHUP 처리를 추가하고, `--remote-debugging-pipe` 또는 node PID를 기다리는 분리형 watchdog으로 외부 kill도 처리 | tools | pipe 방식(프로토콜 변경, 큼)과 watchdog(작음) 중 선택 | 대기 |
| P-02 | 디버깅 포트(9300+random(600))가 비어 있는지, 응답하는 프로세스가 직접 띄운 것인지 확인하지 않는다 | 리뷰 #2, `tools/browser_guard.mjs:111,121` | 중 | port 0과 `DevToolsActivePort` 읽기, 또는 응답 PID가 `proc.pid`인지 확인 | tools | 없음 (P-01과 같이 진행할지 여부) | 대기 |
| P-03 | Guard 테스트가 없다 (lock 인수, stale PID, timeout, profile tag 일치, kill 필터) | 리뷰 #3, `tests/` | 중 | fake child process를 쓰는 node 테스트와 `killGuardedBrowsers` 인용·필터 테스트 추가 | 테스트, tools | 없음 | 대기 |
| P-04 | `game.js` wiring 테스트가 소스 텍스트 regex에 의존한다. "lead-in 동안 engine이 step하지 않는다", "report가 cinematic을 기다린다"는 동작 테스트가 없다 | 리뷰 #5, `tests/js/skip.test.mjs:79-86`, `tests/js/cinematics.test.mjs:99-106` | 중 | lead/ending 판단을 DOM 없는 모듈로 분리하거나 작은 DOM stub으로 `game.js` 실행 | 표시(`game.js` 분리), 테스트 | 표시 코드 분리를 허용할지, DOM stub만 쓸지 | 대기 |
| P-05 | `skipRequested` 플래그가 남아 다음 이륙의 첫 프레임을 건너뛸 수 있다 | 리뷰 #4, `static/cloud-dive/game.js:952-957,982,1058-1059` | 하~중 | `resetCockpitFlight`와 `syncLeadToView`에서 플래그 초기화 | 표시 | 없음 | 대기 |
| P-06 | Invariant 테스트가 그룹 21 base(`GROUP21_BASE = "1565153"`)부터만 검사하고, 커밋이 없으면 skip한다. 그룹 13-20은 무방비 | 리뷰 #6, `tests/test_wording.py` | 하 | base를 그룹 13 직전 커밋(`f78ee61`)으로 고정하고 CI에서 skip 대신 fail | 테스트 | base 커밋 `f78ee61` 확정 여부 | 대기 |
| P-07 | Hot-seat 세션이 Change case에서 확인 없이 사라진다. `store.loading` 중 `openCase`가 반환되어 `submitHotseat` 세션도 조용히 버려진다 | 리뷰 #7, `static/cloud-dive/game.js:327-330` | 하 | 나가기 전 확인 대화상자, 로딩 중 폼 재활성화 | 표시 | 확인 문구 허용 여부 | 대기 |
| P-08 | Hot-seat에서 첫 플레이어의 report가 Best와 Straight-ahead를 뒤 순서 플레이어에게 보여줄 수 있다 | 리뷰 #8, `static/cloud-dive/report-view.js` | 하 (가능성) | 의도가 "각 비행 후에만 공개"라면 results table 전까지 hot-seat report의 reference 표를 숨김 | 표시 | **R20.4의 의도 확인 필요** (5절 질문 Q-1) | 대기 |
| P-09 | Gate 라벨이 앞쪽 3개 셀(`stepKm` 10에서 30 km)의 최악 레벨을 요약하는데, 프레임은 18 km 앞에 그려진다 | 리뷰 #9, `static/cloud-dive/scene.js:259-276` | 하 (가능성) | tooltip 또는 Why-card에 "30 km 구간 요약" 한 줄 추가 | 표시 | 문구 허용 여부 (R9.1 단어 목록 준수) | 대기 |
| P-10 | 출발 카드는 센트까지(`$74.77`) 표시하고, HUD·report·합계는 정수 달러로 표시한다. 구성 항목 합이 총액과 $1 다를 수 있다 | 리뷰 #10, `static/cloud-dive/departure-card.js:15` | 하 | 단일 formatter 사용 | 표시 | 카드를 정수 달러로 맞출지 | 대기 |
| P-11 | Change case 후 `body.lead-active`가 남을 수 있다 | 리뷰 #11, `static/cloud-dive/game.js:327-337` | 미관 | `backToCases`에서 `renderLeadUi` 호출 | 표시 | 없음 | 대기 |
| P-12 | 금지어 목록 `BANNED_R91`에 risk, probability가 없다 (현재 문자열은 사용하지 않음) | 리뷰 #12, `tests/test_wording.py` | 하 | 두 단어를 목록에 추가 | 테스트 | 없음 | 대기 |
| P-13 | 실제 스크린샷으로 확인하지 않은 시각 항목: (a) Observed / Not assessed / Not indicated gate 패턴 (21.10 샷에는 Possible 프레임만 있었음), (b) climb 후 "Continue" 문구 (코드와 node 테스트로만 확인, 샷 없음), (c) 최종 21.10 색상 상수 이후 layout check 재실행, (d) 390x844에서 gate 열이 "no"로 나온 결과 | usage log 21.9 표(22.9 행), 21.10 행, 21.9 layout 결과 | 중 | guard를 거친 headless 검사 1회씩 실행 후 스크린샷 판독. 필요하면 CSS만 조정 | 표시, tools (실행만) | 브라우저 실행 허용 시점. (d)에서 gate 열이 보이지 않아도 되는지 | 대기 |
| P-14 | KJFK-KBNA의 Python/JS parity 테스트가 없다. Departure climb 같은 산술이 두 구현에 따로 있고 한 입력으로 같이 돌리는 테스트가 없다 | usage log 13.1, 리뷰 Details "Departure climb" | 하 | 같은 입력을 Python과 JS에 넣어 결과를 비교하는 테스트 | 테스트 | 없음 | 대기 |
| P-15 | `THIRD_PARTY_NOTICES.md`에 IEM PIREP 항목이 없다 (게임에서 PIREP 데이터를 쓰지 않아 뺐음) | checklist C4 (task 20.1 메모) | 중 | 소유자가 IEM 이용 조건을 제공하면 항목 추가 | 문서 | **소유자가 조건 문구를 제공**. PIREP이 case 선택에 쓰였다면 항목이 필요한지 판단 | 대기 |
| P-16 | 프레임 레이트는 이 노트북에서만 측정했고, 휴대폰은 사람이 확인하지 않았다 | usage log 15.6/18.2, checklist C11, C15 | 중 | 영상과 문서에 "한 노트북에서 측정"이라고 명시. 가능하면 실제 폰에서 소유자가 확인 | 문서 | 실제 폰 확인 여부 | 대기 |
| P-17 | Disclosure 7절(revision a, b 파일의 출처, 모두 Kiro)은 초안이며 소유자 확인 전이다 | checklist C4, `docs/Preexisting_Work_Disclosure.md` | 중 | 소유자가 표와 7절을 읽고 확정 | 문서 | 7절 내용과 파일별 최종 커밋 확정 | 대기 |

항목 수: 17

## 2. 소유자만 할 수 있는 체크리스트 항목 (열림)

`submission-checklist.md`에서 그대로 옮겼다. 체크하지 않았다.

- C2 F1 to F6 확정 (`requirements.md` 5.6). Owner. (D1 decided: replace.)
- C3 Kiro Credit Request Form 제출 기한 **Tue Dec 1, 12:00 pm PT (Dec 2 05:00 KST)**, 코드는 Dec 4까지 redeem. Owner.
- C4 Disclosure. 귀속은 정리됨(git이 귀속할 수 없는 파일 = Claude, 소유자 진술 2026-11-13). 남은 일: 소유자가 표와 7절을 읽기, ECMWF와 NOAA attribution 문구 확인, three.js SHA-256을 `Get-FileHash`로 확인, 파일별 최종 커밋 확인. 메모(task 20.1, 2026-11-14): `THIRD_PARTY_NOTICES.md`에 three.js 0.160.1(MIT, SHA-256), OurAirports(public domain), 데이터 표(ECMWF, NOAA, Natural Earth, Noh, OpenAP, CIRA)가 있다. IEM PIREP은 게임에서 PIREP 데이터를 쓰지 않아 빠져 있다. README는 disclosure와 notices를 링크한다.
- C11 Browser MCP 서버 확인. 상태 2026-11-14: 미완료. `.kiro/settings/mcp.json`이 없다. `docs/screens/15.6-*390x844*`는 `tools/layout_check.mjs`에서 나왔으므로 C11로 치지 않는다. 실제 폰에서 사람이 확인한 적 없다. 범위: 390x844에서 cockpit canvas가 비어 있지 않음, 패널 텍스트와 gate 버튼(44 px) 접근 가능, start와 skip 버튼 동작, V 키와 2D 토글 동작, console 오류 없음.
- C15 영상: 시스템 완성 후 녹화. 영어 AI 음성, 자막, 3분 미만, YouTube 공개, 앱 실행 화면, 제3자 로고·음악 없음(CIRA나 NOAA 스크린샷 금지), 음성 서비스의 공개 사용 허용 확인. Revision b: **KJFK-KBNA**를 3D cockpit으로 녹화(이륙, climb, cruise, gate, anti-ice, report). KDEN-KLAX는 영상에 쓰지 않는다. game note가 화면에 보여야 한다. 지면이 평평하다는 점과 프레임 레이트를 한 노트북에서만 측정했다는 점을 말한다.
- C17 영어 Devpost 양식: category Frankenstein, demo URL, repository URL, testing instructions, disclosure 링크. 초안을 일찍 저장.
- C18 제3자 플랫폼 블로그 글, 마감 전 게시, Kiroween 2026 해커톤의 일부로 쓴다고 명시. Owner. (보너스)
- C19 `#KiroweenHackathon26`로 시작하는 소셜 글, Kiro에서 가장 좋았던 점과 접근 방식이 어떻게 바뀌었는지, 양식에 링크 추가. Owner. (보너스)
- C20 Kiro Crew 앱을 기간 중 새로 만든 별도 GitHub repo로. tasks 1-9 완료 후에만. (보너스)
- C21 최종 점검: Pages 사이트가 **Jan 29 2027**까지 로그인 없이 무료로 유지, 저장소 About에 Apache-2.0 표시, `/.kiro` 존재하고 ignore되지 않음, 모든 테스트 통과, 초안 저장, Dec 3 KST 저녁까지 제출.

C11 외에도 checklist에는 Kiro가 하는 열린 항목(C7, C8, C9, C10, C12, C13, C14, C16)이 있으나 소유자 전용이 아니므로 이 목록에서 뺐다.

## 3. 제안 순서 (소유자가 전부 승인한 경우)

1. Guard 수정: P-01, P-02, P-03 (같은 파일, 다른 항목보다 먼저. 이후 모든 브라우저 검사가 이 guard에 의존한다).
2. Skip 플래그: P-05.
3. 테스트 강화: P-04, P-06, P-12, P-14.
4. 표시 다듬기: P-11, P-10, P-09, P-07. P-08은 Q-1 답변 후.
5. 시각 검증: P-13 (위 수정이 끝난 뒤 한 번에).
6. 문서·소유자 항목: P-15, P-16, P-17은 소유자 입력이 오면.

브라우저 규칙: **한 번에 하나의 guard 실행만, 포그라운드로만.** 항상 `tools/browser_guard.mjs`를 거치고, 실행 전후에 headless `cloud-dive-edge-*` Edge 프로세스가 0개인지 확인한다. 소유자가 허용하기 전에는 브라우저를 시작하지 않는다.

## 4. 결정 요청

각 항목에 "승인" 또는 "보류"로 답해 주세요.

- P-01 승인/보류 (승인 시: pipe 방식 / watchdog 중 선택)
- P-02 승인/보류
- P-03 승인/보류
- P-04 승인/보류 (표시 코드 분리 허용 / DOM stub만)
- P-05 승인/보류
- P-06 승인/보류 (base `f78ee61` 맞는지)
- P-07 승인/보류
- P-08 승인/보류 (Q-1 먼저)
- P-09 승인/보류
- P-10 승인/보류
- P-11 승인/보류
- P-12 승인/보류
- P-13 승인/보류 (브라우저 실행을 허용하는지)
- P-14 승인/보류
- P-15 IEM 이용 조건 문구를 제공할 수 있나요?
- P-16 실제 폰에서 확인할 수 있나요?
- P-17 Disclosure 7절을 읽고 확정했나요?

**Q-1 (R20.4):** Hot-seat에서 reference(Best, Straight-ahead)는 "자기 비행 후에만" 보이면 충분합니까, 아니면 "모든 플레이어가 비행을 마치고 results table이 나올 때까지" 숨겨야 합니까? 후자라면 P-08을 진행합니다.
