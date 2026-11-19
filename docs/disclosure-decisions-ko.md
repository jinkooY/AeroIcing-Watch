# Pre-existing work disclosure: 소유자 결정 목록 (2026-11-19)

대상 문서: [`Preexisting_Work_Disclosure.md`](Preexisting_Work_Disclosure.md) (영문, 제출용),
[`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). 체크리스트 C4, 보류 항목 P-15, P-17, P-20.

규칙 근거: "Projects must be newly created ... after the start of the Hackathon Submission Period",
"must disclose any other pre-existing code or work incorporated", "Insufficient use of Kiro will result in
disqualification at the Judges' sole discretion".

**2026-11-19 소유자 답변을 받아 모두 반영함.** 답: A1-A3 확정, A4 Claude (reviewer), carried out by Kiro, A5 Claude,
B1 유지, B2 본인 저작물·Apache-2.0 공개, B3 이름 쓰지 않음, C1 밝힘, C2 그대로, C3 두기, D1 2026-11-11 Devpost 가입 후
작업 시작, D2 확정, E1 소유자가 요청한 적 없음 (AI 도구가 찾아 넣음; 사례 선정에 실제로 쓰였으므로 IEM 공개 조건과 함께 기록),
E2 유료 API로 최종 합성만, E3 무료 글꼴 (Noto Sans) 로 교체.

## A. 출처 확인 (git으로는 판단할 수 없는 것)

| 번호 | 결정할 내용 | 현재 초안 | 권장 | 답 |
|---|---|---|---|---|
| A1 | 3절의 "Claude (owner-stated)" 표기. 커밋 표시가 없는 초기 백엔드 파일과 viewer 커밋 `66134df`을 Claude가 썼다는 11월 13일 진술을 유지하는가 | 유지 | 유지 | |
| A2 | 6절 파일별 표 (2026-11-13 이전 파일 72개의 출처: Claude, Codex, Kiro, GitHub) 를 읽고 확정 | 초안 | 확정 | |
| A3 | 7절 (revision a, b의 Cloud Dive 파일 전부 Kiro) 확정. P-17 | 초안 | 확정 | |
| A4 | `docs/video/kiro-instructions-review-1.md`, `kiro-instructions-video-quality.md` ("Kiro 지시서" 두 문서) 를 누가 썼는가 | 미정 | 사실대로. Claude가 검토하고 Kiro에게 지시서를 쓴 것이라면 "Claude (reviewer), carried out by Kiro"로 적는 것이 오히려 Kiro 활용 설명에 도움이 됩니다 | |
| A5 | `docs/reviews/2026-11-14-...-review.md` (커밋 `8f0049e`) 와 `docs/pending-items.md` (`a05b283`) 를 누가 썼는가. 둘 다 `claude/...` 이름의 브랜치에서 병합됨 | 미정 | 사실대로. Kiro semantic reviewer 결과라면 Kiro, Claude Code라면 Claude | |

## B. 이전 작업물 재사용

| 번호 | 결정할 내용 | 현재 초안 | 권장 | 답 |
|---|---|---|---|---|
| B1 | WeatherPath 코드 (복사·변형한 함수들) 를 이 저장소의 Apache-2.0으로 공개한다는 11월 13일 진술 유지 | 유지 | 유지 | |
| B2 | Blender 구름 스크립트가 이전 도구 (다른 프로젝트의 이전 Blender 스크립트, 이 저장소에 없음) 의 방식을 따름. 비교 결과 198줄 중 23줄이 같고 모두 Blender 기본 설정 호출, 전체 유사도 0.04, 장면·모델·텍스처 복사 없음. (1) 본인 저작물인지, (2) 이 재사용분을 Apache-2.0으로 공개해도 되는지 | 미정 | 둘 다 "예"라면 그대로 공개 | |
| B3 | 공개 문서에 이전 도구의 폴더 이름을 써도 되는가 | 8절에서는 이름을 빼고 "the owner's earlier, unpublished Blender scripts from another project"로 적음 (2026-11-19). 단 `docs/video/blender-assessment.md` 2행에는 경로가 그대로 있고, 이미 공개 저장소에 푸시됨 (`8db399a`) | 이름을 써도 되면 그대로 두고, 민감하면 blender-assessment.md도 같은 문구로 바꿈. 과거 커밋에는 남음 | |

## C. 다른 AI 도구 사용을 어떻게 밝힐지

| 번호 | 결정할 내용 | 현재 상태 | 권장 | 답 |
|---|---|---|---|---|
| C1 | Devpost write-up에서 Claude, Codex 사용을 밝히는 수준 | README와 공개 문서에만 있음 | write-up에 한 문단으로 명시: "Claude wrote the first FastAPI prototype and legacy satellite sources (2026-11-11 to 11-12), Codex the legacy route demo; every Cloud Dive file was built with Kiro". 숨기면 실격 사유가 될 수 있고, 밝히면 Kiro 사용 범위가 오히려 분명해집니다 | |
| C2 | Claude·Codex가 쓴 레거시 코드를 저장소에 둘지 | 그대로 두고 README에 "Legacy, not part of the entry"로 표시 | 그대로 둠 (git 기록에도 남으므로 지워도 공개 사실은 같음) | |
| C3 | 원격에 올라가 있는 병합 안 된 브랜치 2개 (`origin/claude/aeroicing-watch-3d-review-340178`, `origin/claude/kiro-research-direction-review-b971c3`) | 공개 저장소에 보임 | 두기. 지우려면 직접 결정 (되돌리기 어려움) | |

## D. 사실 확인

| 번호 | 결정할 내용 | 현재 초안 | 권장 | 답 |
|---|---|---|---|---|
| D1 | 제출 기간 시작일. 문서에는 2026-10-30으로 적혀 있으나 이번에 받은 규칙 본문에서는 날짜를 확인하지 못함 | 2026-10-30 | Devpost 규칙 페이지에서 날짜 확인 후 알려 주세요. 첫 커밋 (2026-11-11) 은 어느 경우든 기간 안으로 보입니다 | |
| D2 | ECMWF와 NOAA 귀속 문구 (`THIRD_PARTY_NOTICES.md` 끝, 게임 화면의 출처 줄) | 초안 | 확정 | |

## E. 데이터와 서비스 조건 (`THIRD_PARTY_NOTICES.md`)

| 번호 | 결정할 내용 | 현재 상태 | 권장 | 답 |
|---|---|---|---|---|
| E1 | IEM PIREP 이용 조건 문구 (사례 선정에만 사용, 게임에는 없음). P-15 | 자리만 만들어 둠 | 조건 문구를 주시거나, IEM 웹 페이지 주소를 주시면 제가 찾아 넣겠습니다 | |
| E2 | Gemini TTS로 만든 음성의 공개 사용 조건. P-20 | 유료 API 보유, 최종 합성에만 사용 (2026-11-19) | 유료 API 약관에서 "생성물 소유·공개 사용"을 확인 | |
| E3 | 영상 자막과 카드에 쓴 Segoe UI (Windows 글꼴) | 사용 중 | 문제가 걱정되면 무료 글꼴 (예: Noto Sans) 로 바꿀 수 있음. 제가 바꾸는 데 10분 정도 | |

## 정리되면 제가 할 일

1. 답을 영문 공개 문서 3절, 6절, 7절, 8절과 `THIRD_PARTY_NOTICES.md`에 반영하고 "owner to state" 표시를 지웁니다.
2. 체크리스트 C4와 보류 항목 P-15, P-17, P-20을 닫습니다.
3. Devpost write-up의 공개 문단 (C1) 을 확정합니다.
