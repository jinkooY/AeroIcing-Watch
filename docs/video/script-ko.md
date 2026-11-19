# Cloud Dive 영상 대본: 영어 원문과 한글 해석 (검토용)

영어 원문이 기준입니다 (`script.json`). 한글은 검토용 해석이며 영상에는 쓰지 않습니다.
`[ ]`는 최종 빌드에서 채울 값입니다. 지금은 남은 자리표시자가 없습니다(r2는 38달러, 동결 빌드에서 재확인).
화면 구성은 `storyboard.md`를 보세요. 예상 길이는 약 2:50이며 실측 전 추정치입니다.

| id | 장면 | English (음성) | 한글 해석 |
|---|---|---|---|
| h1 | 1 훅 | November twelfth. A real day. Real clouds over the eastern United States. | 11월 12일. 실제로 있었던 날. 미국 동부 하늘의 진짜 구름. |
| h2 | 1 훅 | This is Cloud Dive, a game for students and aviation fans. You fly. Fuel cost is your score. | 학생과 항공 팬을 위한 게임, 클라우드 다이브입니다. 당신이 조종합니다. 점수는 연료비입니다. |
| p1 | 2 문제 | Icing matters to flights, and avoiding it costs money. A longer path, a climb, or anti-ice fuel. | 결빙은 비행에 중요한 문제이고, 피하는 데는 돈이 듭니다. 더 긴 경로, 상승, 또는 방빙 연료. |
| p2 | 2 문제 | Today: New York to Nashville. | 오늘의 비행: 뉴욕에서 내슈빌까지. |
| g1 | 3 플레이 | Cruise runs fast. When Possible or Observed evidence is ahead, the game stops. That is a gate. | 순항은 빠르게 진행됩니다. 앞에 Possible 또는 Observed 근거가 있으면 게임이 멈춥니다. 이것이 게이트입니다. |
| n1 | 3 플레이 | First gate. Here only the forecast rule is met, so the label says: possible, forecast only. | 첫 번째 게이트. 여기서는 예보 규칙만 충족되므로, 라벨은 "Possible, 예보만"이라고 나옵니다. |
| g4 | 3 플레이 | Each choice shows the evidence ahead. The costs stay hidden. | 선택마다 앞쪽의 근거가 보입니다. 비용은 숨겨져 있습니다. |
| n2 | 3 플레이 | I climb to twelve thousand feet, switch anti-ice on, and continue. | 12,000피트까지 상승하고, 방빙을 켜고, 계속 갑니다. |
| n3 | 3 플레이 | At the fifth gate. This cloud comes from satellite data: its top, its phase, an estimated base. | 다섯 번째 게이트. 이 구름은 위성 데이터로 만들어졌습니다. 구름 꼭대기, 상(phase), 추정한 구름 밑면입니다. |
| g3 | 3 플레이 | The label reads: observed supercooled layer at planned altitude. The satellite sees the top. The base is estimated. | 라벨에는 "계획 고도에서 관측된 과냉각 층"이라고 나옵니다. 위성은 구름 꼭대기를 봅니다. 밑면은 추정값입니다. |
| n4 | 3 플레이 | I could go around, but a detour costs too. I stay in lane, anti-ice on. | 돌아갈 수도 있지만 우회에도 비용이 듭니다. 차선을 유지하고 방빙을 켭니다. |
| g5 | 3 플레이 | Anti-ice off, flying on? The game's ice index builds, drag grows, and the dollars climb. | 방빙을 끄고 계속 날면? 게임의 얼음 지수가 오르고, 항력이 커지고, 비용이 올라갑니다. (별도 녹화 장면. 리포트의 Straight-ahead 기준과 다른 비행입니다) |
| r1 | 4 결과 | The report compares my cost with three game references. | 리포트는 제 비용을 게임 기준값 세 가지와 비교합니다. |
| n5 | 4 결과 | The costs are itemized: cruise, climb, detour, anti-ice, ice drag. | 모든 비용이 항목별로 나옵니다: 순항, 상승, 우회, 방빙, 얼음 항력. |
| r2 | 4 결과 | I finished 38 dollars above Best, the game reference. The report replays Best, gate by gate. | 저는 게임 기준값 Best보다 38달러 높게 끝냈습니다. 리포트는 Best를 게이트별로 다시 보여 줍니다. |
| d2 | 5 실제 데이터 | It reads GOES cloud data and an ECMWF forecast, estimates the cloud base with a published method, and corrects for parallax. | GOES 구름 데이터와 ECMWF 예보를 읽고, 발표된 방법으로 구름 밑면을 추정하며, 시차(parallax)를 보정합니다. |
| d3 | 5 실제 데이터 | No language model. No randomness. No network call in the decision. | 언어 모델도, 무작위성도, 판정 중 네트워크 호출도 없습니다. |
| d5 | 5 실제 데이터 | In real operations, dispatchers and crews decide, with official icing forecasts and pilot reports. This engine, not yet evaluated, could add where the evidence lies along the route. | 실제 운항에서는 디스패처와 승무원이 공식 결빙 예보와 조종사 보고를 바탕으로 결정합니다. 아직 평가되지 않은 이 엔진은 경로를 따라 근거가 어디에 있는지를 더할 수 있습니다. |
| k1 | 6 Kiro | In Kiro, a spec defined the requirements and correctness properties. | Kiro에서 스펙이 요구사항과 정확성 속성을 정의했습니다. |
| k2b | 6 Kiro | Writing those properties exposed gaps in our own rules. | 그 속성을 쓰는 과정에서 우리 규칙의 빈틈이 드러났습니다. |
| k3b | 6 Kiro | Steering holds the wording rules, and a hook runs the wording test on each game-file save. | 스티어링에 표현 규칙이 있고, 게임 파일을 저장할 때마다 훅이 표현 테스트를 실행합니다. |
| c1 | 7 마무리 | The limits. The ground is flat. The ice index is a game state, not an icing model. Costs are illustrative. Frame rate measured on one laptop. | 한계입니다. 지면은 평평합니다. 얼음 지수는 게임 상태값이지 결빙 모델이 아닙니다. 비용은 예시용입니다. 프레임 속도는 노트북 한 대에서만 측정했습니다. |
| c2 | 7 마무리 | Cloud Dive. Real data, honestly labeled. Play it free, in your browser. | 클라우드 다이브. 실제 데이터를 정직하게 표시했습니다. 브라우저에서 무료로 해 보세요. |

## 이전 버전에서 바뀐 점

- 첫 게이트는 데이터상 "Possible (forecast only)"입니다. Observed 라벨은 뒤의 게이트에서 나옵니다. 그래서 순서를 n1(Possible) -> n3, g3(Observed)로 바꿨습니다.
- 데모 비행은 솔버의 최선 패턴을 따릅니다: 초반에 12,000피트로 상승, 차선 유지, 구름 앞에서만 방빙(n2, n4). 최선 비행은 차선을 바꾸지 않으므로 "차선을 옮긴다"는 줄(g6)을 뺐습니다.
- 비용 항목은 리포트 장면(n5)으로 옮겼습니다. 비행 중 HUD에는 총액만 나옵니다.
- Kiro 구간에서 증거 없는 줄(반례, 커스텀 에이전트, MCP)을 뺐습니다. 로그에는 "속성 테스트가 첫 실행에 통과했고, 속성을 정리하다 빈틈을 찾았다"만 있습니다.

## 점검 1차 (2026-11-15)에서 바뀐 점

- n1: "Never observed."를 뺐습니다. 비행 초반 30km에 Observed 셀이 하나 있어서, 첫 게이트 미니맵에 주황 해치가 보입니다(게임은 그 지점에서 멈추지 않습니다).
- g5: "Straight ahead"를 "Anti-ice off, flying on?"으로 바꿨습니다. 뒤의 리포트 Straight-ahead 기준(가운데 차선, 출발 고도, 결빙 셀에서 방빙 On)과 같은 말로 들리지 않게 하려는 것입니다.
- c1: "한 노트북에서 테스트"를 "프레임 속도는 한 노트북에서 측정"으로 바꿨습니다. 제출 규칙 C15가 말하라는 것은 프레임 속도입니다.
- 게이트 위치는 계산해서 정했습니다(`node tools/video/gate_plan.mjs`). 관측 라벨이 앞에 보이는 게이트는 약 500km 지점(5번째 게이트)입니다. 380km 부근이 아닙니다.
