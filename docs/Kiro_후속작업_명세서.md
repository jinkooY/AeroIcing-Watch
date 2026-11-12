# AeroIcing Watch Kiro 후속 작업명세서

작성일 2026-11-13 · 상태 초안 · 기준 PR [#2](https://github.com/jinkooY/AeroIcing-Watch/pull/2) (`claude/aeroicing-watch-3d-review-340178`)
Kiro 크레딧 발급 예정 2026-11-16

## 1. 목적과 원칙

대회 제출물에는 Kiro 기능을 사용한 작업 내역이 있어야 한다. 이 문서는 크레딧이 발급되면 Kiro에서 이어서 할 작업을 정하고, Kiro에 넣을 입력과 완료 기준을 정리한다.

- **Kiro 산출물은 Kiro에서 만든다.** 이 문서는 Kiro에 넣는 입력이다. `.kiro/specs/…`의 requirements, design, tasks 파일과 steering, hook 파일은 다른 도구로 미리 쓰지 않는다. Kiro의 spec 흐름이 직접 생성·수정하게 해야 작업 내역이 남는다.
- **기록은 사실대로 남긴다.** 3D 재생 1단계(R1–R5)는 Claude Code가 구현했다. 제출 문서의 “How Kiro was used”에는 Kiro가 한 작업과 다른 도구가 한 작업을 구분해 적는다. Kiro 작업 내역을 뒤늦게 꾸며 넣지 않는다.
- **여러 Kiro 기능을 실제 작업에 쓴다.** Spec(요구사항 → 설계 → 작업), Steering, Agent Hooks를 각각 실제 산출물과 연결한다. 시연용으로만 쓰지 않는다.

## 2. 현재 상태

| 항목 | 상태 |
|---|---|
| 데이터 계약 R1·R2 | 완료. `scenario.json` schema 2, `replay.track` 경계 궤적, 계약 테스트 4개 통과 |
| 3D 재생 R3–R5 | 완료. `replay.html` 및 관련 파일, CesiumJS 1.120.0, ion 키 없음, WebGL 대체 화면 |
| 2D 연동 | 완료. 실제 경계 궤적으로 선 그리기, `#route=&segment=` 양방향 연동 |
| 미검수 | 화면이 보이는 상태에서 연속 재생, 공개 HTTPS URL, 실제 모바일 기기 |
| 디자인 | 기능 수준만 구현. 사용자가 별도 재검토를 요청함 |
| 기존 Kiro 자산 | `.kiro/specs/aeroicing-watch/`(위성 단면 기능), `.kiro/steering/project.md`(GK-2A 중심, 현재 공개 데모와 맞지 않음), hook 2개(tasks.md 진행률) |

## 3. 후속 작업 선정

| 후보 | 3일 뒤 바로 시작 가능 | 제출 가치 | 판단 |
|---|---|---|---|
| **A. 3D 재생 디자인·사용성 개선** | 가능. 시작 조건 없음 | 높음. 시연 화면이 직접 좋아짐 | **주 작업** |
| B. 1단계 검수 마무리(실기기, 공개 URL) | 가능 | 필수. 작업량은 적음 | A의 마지막 작업에 포함 |
| C. 지도에서 경유점 편집(E1) | 부분 가능. 공개 데모에서 API 호출 불가 | 중간 | 시간이 남으면 로컬 모드로 시도 |
| D. 위성 CTPS 연동(S1·S2) | 불가. 시공간이 겹치는 사례와 재배포 권한 미확보 | 높음 | 이번 범위에서 제외 |

A를 Kiro spec 기능 하나(`route-replay-3d-design`)로 진행하고, B를 그 spec의 마지막 단계로 둔다. C는 선택 확장으로 7절에 남긴다.

## 4. Kiro 작업 순서

### K0. 크레딧 발급 전 준비 (지금–11/15, Kiro 없이)

- PR #2를 검토하고 `main`에 병합한다. Kiro는 `main`에서 새 브랜치(예: `kiro/route-replay-3d-design`)를 만들어 시작한다.
- **Publish route comparison demo** 워크플로를 실행하고, 공개 URL에서 2D와 3D 화면이 로딩되는지만 먼저 확인한다.
- 현재 화면을 데스크톱과 모바일에서 캡처해 둔다. 디자인 개선 전후 비교와 시연 영상에 쓴다.

### K1. Steering 갱신 (Kiro, 1일차)

Kiro에게 다음 두 가지를 요청한다.

1. `.kiro/steering/project.md`를 현재 프로젝트에 맞게 고친다. 공개 데모가 보관 IFS 예보로 두 항로를 비교·재생한다는 점을 반영하고, 위성 단면은 개발용 API로 구분한다.
2. `static/route-demo/**`에만 적용되는 steering 파일을 새로 만든다. front matter는 `inclusion: fileMatch`로 한다. 담을 규칙은 다음과 같다.
   - 빌드 단계 없음, 바닐라 JS, 외부 스크립트는 버전을 고정한 CDN만 사용
   - API 키나 Cesium ion 사용 금지. 배경은 NaturalEarthII
   - `scenario.json` schema 2 계약과 `#route=<id>&segment=<0-based>` 해시 계약은 바꾸지 않음
   - ECMWF 출처·라이선스 문구와 Cesium 크레딧은 숨기지 않음
   - 표시 수치는 `scenario.json` 값과 일치해야 함. 결빙 정확도는 “미평가”로 유지
   - 2D와 3D가 같은 색과 같은 후보 표기를 사용

### K2. Spec 작성 (Kiro spec 흐름, 1일차)

Kiro의 spec 기능으로 `.kiro/specs/route-replay-3d-design/`을 만들고 requirements, design, tasks 순서로 진행한다. 5절의 개선 요구를 입력으로 준다. 각 단계 결과를 사람이 검토·승인한 뒤 다음 단계로 넘어간다. 승인 과정도 작업 내역에 포함된다.

### K3. Agent Hooks (Kiro, 1일차)

| Hook | 트리거 | 동작 |
|---|---|---|
| 정적 데모 검사 | `static/route-demo/*.js` 저장 | `node --check`로 문법 확인. 오류가 있으면 파일과 줄을 보고 |
| 데이터 계약 검사 | `tools/export_route_demo.py`, `src/analysis/route_*.py`, `scenario.json` 저장 | `python -m pytest tests` 실행 후 결과 요약 |
| 새 spec 진행률 | `.kiro/specs/route-replay-3d-design/tasks.md` 저장 | 기존 진행률 hook과 같은 형식으로 보고 |

기존 진행률 hook은 `aeroicing-watch/tasks.md`만 본다. 새 spec 경로를 추가하거나 새 hook을 만든다.

### K4. 구현 (Kiro, 2–3일차)

Kiro가 만든 tasks.md를 위에서부터 하나씩 실행한다. 작업 하나가 끝날 때마다 체크하고 커밋한다. 커밋 메시지에 작업 ID를 넣으면(예: `T3: Add sticky playback bar on mobile`) Kiro 작업 내역과 git 기록이 연결된다.

### K5. 검수와 배포 (Kiro, 3일차)

6절의 기준을 확인하고 `main`에 병합한 뒤 Pages를 다시 배포한다. 공개 URL에서 데스크톱과 실제 휴대폰으로 확인한다.

### K6. 제출 증빙 정리 (3일차)

- `docs/AeroIcing_Watch_Submission_Package.md`의 “How Kiro was used”를 갱신한다. 사용한 기능(spec, steering, hooks)과 각 산출물 경로, 커밋을 적는다. 3D 재생 1단계는 Claude Code가 구현했다고 적는다.
- Kiro 세션 화면(spec 승인, hook 실행 결과)을 캡처하거나 짧게 녹화한다.
- 시연 영상을 새 3D 화면 기준으로 다시 녹화할지 결정한다.

## 5. 디자인·사용성 개선 요구 (K2 입력)

PR #2 검수 중 확인한 문제와 명세서상 빈 곳을 정리했다. Kiro requirements 단계에서 사용자 이야기와 인수 조건으로 바꾼다.

| ID | 문제 | 개선 요구 | 인수 조건 |
|---|---|---|---|
| D1 | 모바일에서 지구본 아래로 카드와 재생 버튼이 밀려 재생 중 조작이 어렵다 | 재생·일시정지, 시간, 배율을 담은 하단 고정 바 | 375×812 화면에서 스크롤 없이 지구본과 재생 바가 함께 보임 |
| D2 | 구간 선택이 52개 항목의 드롭다운이다 | 타임라인에 구간 눈금과 경유점·출발·도착 표시. 드롭다운은 보조 수단으로 남김 | 타임라인에서 경유점 위치를 눈으로 찾고 클릭하면 이동 |
| D3 | 2D는 경유 후보를 점선으로, 3D는 실선으로 그려 표기가 다르다 | 2D·3D 공통 범례와 선 스타일 | 두 화면의 색, 선 스타일, 후보 이름이 같음 |
| D4 | 순항고도 9,144 m가 지구본 축척에서 거의 보이지 않는다 | 선택 시 항로 아래로 지면까지 내리는 반투명 벽. 과장 배율을 쓰면 화면에 표기 | 높이 표현이 켜져 있으면 배율 문구가 보임 |
| D5 | 구간 정보 패널에 값이 많이 나열되어 눈에 잘 들어오지 않는다 | 핵심 값(통과 시각, 바람, 지상속도) 위주로 묶고 나머지는 접기 | 기본 화면에서 핵심 값 5개 이하 |
| D6 | 두 후보의 재생 시간이 다를 때 비교할 수단이 없다 | 비선택 후보의 같은 경과 시간 위치를 흐린 표식으로 표시(선택 기능) | 켜면 두 표식이 같은 UTC에 위치 |
| D7 | 재생 배율 기본값과 모바일 지원 범위가 명세에 없다 | 기본 60×, 최소 지원 폭 360px, 지원 브라우저를 명세에 기록 | 원 명세서에 해당 내용 추가 |
| D8 | 2D 페이지 디자인이 3D와 따로 논다 | 헤더, 배지, 색 토큰을 `styles.css` 하나로 통일 | 두 페이지가 같은 CSS 변수를 사용 |
| D9 | 접근성 미확인 | 키보드만으로 후보 선택, 재생, 탐색 가능. 대비 4.5:1 이상. `prefers-reduced-motion`이면 카메라 비행 생략 | 키보드만으로 전 과정 완료 |

지켜야 할 제약은 다음과 같다. 수치와 데이터 계약은 바꾸지 않는다. API 키를 추가하지 않는다. 빌드 단계를 추가하지 않는다. ECMWF·Cesium 출처 표기를 유지한다.

## 6. 검수 기준

| 항목 | 통과 조건 |
|---|---|
| Kiro 내역 | `.kiro/specs/route-replay-3d-design/`에 requirements, design, tasks가 있고 tasks가 모두 체크됨. 새 steering 1개 이상, 새 hook 2개 이상. 관련 커밋이 Kiro 작업 ID를 참조함 |
| 회귀 | `python -m pytest tests` 통과. 2D↔3D 해시 왕복 시 같은 구간과 같은 중점 ETA 표시 |
| 디자인 | D1–D5, D8, D9 충족. D6은 선택 |
| 재생 | 화면이 보이는 상태에서 연속 재생, 경유점 통과, 종료 시 정지 확인 |
| 배포 | 공개 HTTPS URL에서 로그인 없이 작동. 실제 휴대폰에서 후보 선택과 재생 확인. 콘솔 오류 없음 |
| 증빙 | 제출 문서가 Kiro 작업과 다른 도구의 작업을 구분해 기록함 |

## 7. 선택 확장: 경유점 편집 로컬 모드(E1)

D1–D9를 마치고 시간이 남을 때만 진행한다. 별도 Kiro spec(`route-waypoint-editing`)으로 만든다.

- `http://localhost`에서 FastAPI가 함께 실행될 때만 편집 기능을 켠다. 공개 정적 데모에서는 숨긴다.
- 지도에서 중간 경유점을 추가·이동·삭제하고 초안 선을 표시한다. 같은 예보, 출발 시각, 항공기 조건으로 `POST /api/route-review/evaluate`를 호출한다.
- 오류 상태(경유점 중복, 예보 범위 밖, 번들 없음, 평가 실패)를 표시한다. 재요청 중에는 이전 결과를 현재 초안의 결과로 보여주지 않는다.
- 공개 데모에서 쓰려면 서버 호스팅이 필요하므로 이번 제출에서는 로컬 시연 영상으로만 보여준다.

## 8. 일정

| 날짜 | 작업 |
|---|---|
| 11/13–11/15 | K0: PR #2 병합, 공개 URL 1차 확인, 현재 화면 캡처 |
| 11/16 (크레딧 발급) | K1 steering, K2 spec(요구사항·설계·작업 승인), K3 hooks |
| 11/17 | K4: D1–D3, D8 구현 |
| 11/18 | K4: D4, D5, D9 구현. 시간이 남으면 D6 |
| 11/19 | K5 검수·배포, K6 증빙 정리. 제출 마감일은 [대회 규정](https://kiroween.devpost.com/rules)에서 다시 확인 |

## 9. Kiro 첫 요청문

크레딧 발급 후 Kiro에서 `main` 기반 새 브랜치를 열고 아래 요청으로 시작한다.

> Read `docs/Kiro_후속작업_명세서.md`, `docs/3D_Replay_Spec_Review.md` and `docs/AeroIcing_Watch_3D_항로재생_작업명세서.md`. First update `.kiro/steering/project.md` for the current public route demo and add a fileMatch steering file for `static/route-demo/**` with the rules in section K1. Then start a new spec `route-replay-3d-design` from the design requirements D1–D9 in section 5, keeping the constraints listed there. Write requirements first and wait for my approval before design and tasks. All file content must be in English.
