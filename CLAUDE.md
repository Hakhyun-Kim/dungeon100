# 백층 던전 (Dungeon 100)

매판 새로 생성되는 던전을 뚫고 100층까지 내려가는 **탑다운 3D 로그라이크** (three.js + react-three-fiber). 모바일 우선 웹앱 (React + Vite + TypeScript).
**공개 저장소** — NAN 2026 (NHN Game × AI Hackathon) 사전과제 **제출작(확정)**. 시크릿·내부 경로 커밋 금지.
설계·로드맵: `docs/DESIGN.md` (주차별 계획 포함 — 작업 완료 시 체크 갱신).

## 문서 관리 원칙
- **작업을 마칠 때마다** 이 문서(구조·규칙 변경분)와 `docs/DESIGN.md`(체크리스트·시스템 설명)를 갱신할 것.
- 아래 "다음 후보" 섹션을 항상 최신으로 유지 — 끝낸 항목은 지우고, 새로 떠오른 아이디어를 우선순위와 함께 추가.

## 다음 후보 (우선순위)
1. **밸런스 자동 시뮬레이터** — `__pump`+`__d100fixdt` 하네스로 자동 봇 N판 → 사망 층 분포 리포트 (AI 활용 문서 하이라이트). 적 4타입·메타 성장·몬스터 아레나가 생겨 밸런스 점검 필요성 커짐.
2. **몬스터 아레나 밸런스 튜닝** — 4타입 전부 1층부터 섞임(완료). 남은 것: 보석 근처 스폰 몰림 방지·유도, 클리어 난이도 층별 곡선 조정(aliveCap/enemyMaxHp/touchDmg — 현재 dasher+탄막 때문에 가만히 있으면 금방 죽음), 타입 분포 비율 튜닝. 처치가 코인에 반영 안 됨(무한 재도전 파밍 방지) — 의도된 것.
3. **처치 콤보** — 연속 처치 시 코인 배율(x2·x3), 콤보 이펙트 — 전투 몰입 + 코인 경제 연결.
4. **층 테마 색 변화** — 10층 단위 바닥·벽·안개 팔레트 교체 (절차 생성이라 저비용).
5. **모바일 진동** (navigator.vibrate) — 피격·처치·보물에 짧은 진동.
6. **두 게임 통합** — 두 문 러너를 백층 던전의 정식 모드로 흡수 (README에 계획 명시됨). 해커톤 이후 검토.
7. **제출 준비** — 플레이 영상 촬영(SUBMISSION.md 가이드), 문서 PDF 변환, 마감일 기입, **디버그 키(Shift+D) 게이트 재도입 여부 결정**.

## 실행
- `npm install` — 최초 1회
- `npm run dev` — 개발 서버 (기본 포트 5175, `PORT` 환경변수로 변경 가능)
- `npm run typecheck` — 타입 검사
- `npm run build` — 프로덕션 빌드
- **디버그 층 이동: Shift+D** (Esc 닫기) — 빠른 버튼(1·5·10·…·100층) + 직접 입력, 이동 시 체력 회복. DEV에서는 항상, **배포판에서는 `?debug` 쿼리 필요** (예: …/dungeon100/?debug — 제출 심사자 오작동 방지를 위해 제출 전 재게이트, 2026-07-13). `e.code` 기반이라 한/영 입력 상태 무관. 일반 `d`는 이동 키라 Shift 조합 사용, 이동 키는 Shift 조합 무시.
- **오버레이 키보드 선택**: 모든 선택 화면을 마우스 없이 진행 가능 — 두 갈래 선택(두 문 보상·포털·마을 문·엔딩)은 ←/↑=1번·→/↓=2번, 드래프트 3장은 ←/↑↓/→ 또는 1·2·3, 진행 버튼·대사는 Enter/Space/→. 숫자 키 1~4는 모든 선택지에서 동작.
- HUD는 z-index 50으로 오버레이(30) 위 — 음소거(🔊) 버튼이 팝업 중에도 항상 눌린다.
- 숨김 탭(헤드리스 프리뷰)에서는 크롬이 rAF를 멈춰 3D가 안 그려짐 — `?rafshim` 쿼리로 우회 (index.html의 개발용 심: 타이머 rAF + ResizeObserver 폴리필 + **`window.__pump(n)` 동기 프레임 구동**). 크롬 집중 스로틀링(오래 숨겨진 탭, 타이머 분당 1회)에서는 타이머가 다 죽으므로 자동 검증은 `__pump` + `__d100fixdt`(고정 dt) + MessageChannel 틱(스로틀 안 됨)으로 구동할 것. 클릭 후 React 렌더는 태스크 경계가 필요 — 같은 evaluate 안에서는 MessageChannel 왕복(tick) 후 DOM을 읽어야 함. DEV 훅: `__d100`(teleport/state/hitBoss/killEnemies), `__d100run`(place/state), `__d100arena`(place/state/collect/hurt — 몬스터 아레나), `__d100town`(place/state — 걸어다니는 마을), `__d100app`(jump — 층 점프). r3f 부팅은 클릭 루프보다 느릴 수 있으니 `window.__d100` 등장까지 넉넉히 대기할 것. (아레나 훅은 씬 마운트 직후 passive effect라 같은 evaluate 안에서 tick 몇 번 돌려야 등장.)
- 배포: main 푸시 → `.github/workflows/deploy-pages.yml` → https://hakhyun-kim.github.io/dungeon100/

## 구조
- `src/App.tsx` — phase 상태 머신: `title` → `story`(인트로, 최초 1회·건너뛰기 가능) → `village`(**걸어다니는 3D 마을** — 던전 입장 전·5층 방문·부활 공용) → `run` → **보물상자 미니게임(모드에 따라 갈림)**: 수학 모드 → `doorrun`(두 문 달리기, 최대 3라운드 푸시-유어-럭) / 몬스터 모드 → `arena`(몬스터 무리+보석 3개) → `quiz`(결과/계속 선택) → `portal`(다음 층 내려갈지 선택 — 거절 시 portalRetryRef 증가로 포털 재무장) → `draft`(보상 3택 1) → `run` / `over`(사망 → 재도전 or 마을). HUD·빌드 칩·오버레이는 캔버스 위 DOM. 사망 판정은 hp useEffect. Canvas는 run 계열 phase에만 마운트(배경·fog는 Canvas 레벨), 층 전환은 DungeonScene key 리마운트, 미니게임 라운드는 DoorRunScene/GemArenaScene key 리마운트. 미니게임 결과는 quizResultRef(seq 증가)로 던전 씬에 전달. 보상: 통과한 문·주운 보석 수 = 아이템 수, 3개 완주 = 전설(3개+완전회복), 실패 = 전부 빈손. **보물상자 모드 분기**는 modeRef(onChest useCallback 안 stale 방지)로 판단.
- **몬스터 아레나** (보물상자 '몬스터' 모드, `arena`/`arenaover` phase + `GemArenaScene`) — 수학 대신 우르르 몰려오는 무리를 뚫고 바닥의 보석 3개를 몸으로 주우면 능력치업(=3문 완주와 동일 보상). **아레나 전용 체력**(ARENA_MAX_HP=100, 본체와 분리)이 0이 되면 `arenaover`로 — 본체는 무사하고 **몇 번이고 재도전**(arenaTry로 리마운트) 또는 모은 보석만큼 받고 나가기(`bailArena`→grantRewards(N)). 아레나 HUD는 👹 + 아레나 체력바 + 💎 진행도. DEV 훅 `__d100arena`(place/state/collect/hurt).
- `src/three/DungeonScene.tsx` — 층 하나의 씬+시뮬레이션. 지형·적·투사체·파티클 전부 InstancedMesh. 시뮬레이션은 useFrame에서 ref 기반(React 상태는 onDamage/onKill/onExit/onChest 이벤트만). 타격감: 피격 흰색 번쩍(인스턴스 색)+넉백+스파크, 처치 폭발, 카메라 셰이크. 파워업 시각화: 멀티샷 궤도 구슬, 공격력별 투사체 크기·색, 체력별 몸집, 보물 획득 황금 잔광. 입력은 useMoveInput 훅 (키보드 + 터치 드래그, button 위에서는 시작 안 함). pausedRef로 퀴즈/드래프트/게임오버 중 정지. DEV 전용 `window.__d100`(teleport/state) — 자동 검증용.
- `src/lib/dungeon.ts` — 절차 생성. 방 흩뿌리기 + 폭 2 L자 복도 순차 연결(연결 보장). `GRID`=44셀, `CELL`=2. 충돌은 `canStand`(네 모서리 셀 검사). 시작 방 안전지대, 출구 인접 스폰 금지, 층당 보물상자 1개(시작·출구에서 떨어진 곳).
- `src/three/DoorRunScene.tsx` — **두 문 달리기 미니게임** (두 문 러너 인게임 재현). 자동 달리기 + 좌우 조작(useSteer: 화면 좌/우 꾹·←/→), 보라 게이트·유리 옆벽·문제판, 문 사이 벽 막힘, 몸으로 정답 문 통과 → onDone(true)·색종이 / 오답 💥 뒤로 넘어짐·정답 문 초록 표시 → onDone(false). 미니게임 동안 DungeonScene은 hidden(보임·카메라 양보). DEV 훅 `__d100run`(place/state), 시간 가속 `__d100speed`.
- `src/three/GemArenaScene.tsx` — **몬스터 아레나 미니게임** (보물상자 '몬스터' 모드). 오픈 아레나(반경 ARENA_R=9, 그리드 없이 경계 클램프) + 계속 몰려오는 무리(aliveCap까지 재스폰) + 고정 위치 보석 3개(octahedron). **무리는 1층부터 4타입 전부 섞임**(pickArenaType — chaser/shooter/dasher/tank, 본체 던전을 미리 맛보게 + 긴장감) — 타입별 AI·실루엣·슈터 탄막(eshots)까지 본체 이식. 본체와 동일한 useMoveInput·자동조준 발사·넉백(탱커 면역)·파티클 재사용. 보석 3개 완수 → onDone(true,3)·전설 보상, 체력 0 → onDone(false, 모은 보석 수). 아레나 동안 DungeonScene은 hidden(카메라 양보). DEV 훅 `__d100arena`.
- `src/three/TownScene.tsx` — **걸어다니는 3D 마을** (`village` phase). 옛날 RPG처럼 광장(우물·여관·대장간·촌장 집·나무·담장)을 useMoveInput으로 돌아다니며, NPC(👵촌장/👧니나/🧔무크)에 다가가면 하단에 상호작용 버튼 → 대화, 던전 입구 아치로 다가가면 내려가기. 씬은 근처 대상만 onNear로 App에 보고(이름표는 makeTextTexture 스프라이트). App이 대화창(`.village-talk`)·입구 선택지를 DOM으로 렌더. 상황(TownContext)에 따라 입구가 다르게: `enter`=난이도(모드) 선택→1층 / `visit`=현재 층 복귀 / `death`=체크포인트 층. 대화 중에만 이동 정지(villagePausedRef). 56층 소녀는 여전히 별도 DOM 화면(`town` phase). DEV 훅 `__d100town`(place/state).
- `src/three/Hero.tsx` — 공용 주인공 블록 캐릭터 (던전·미니게임·마을 세계관 통일).
- `src/three/textTexture.ts` — 한글 텍스트 → 캔버스 텍스처 (문제판·문 답, 두문러너 labels.ts 축소판).
- `src/lib/quiz.ts` — 미니게임 문제 생성. **던전 종류(DungeonMode: 'kids' 초등 / 'adult' 어른 / 'monster' 몬스터)** × 층 깊이로 난이도 결정 — kids: 한자리±→두자리±→곱셈구구→두자리×한자리 / adult: 두자리±→두자리×한자리→혼합→두자리×두자리. 'monster'는 수학 대신 아레나 전투라 makeQuiz 미호출. 근접 오답, 문제 은행 없음. 라운드 보정 +6/라운드. 던전 입구(마을 choice)에서 모드 선택, HUD에 🎒/🧠/👹 표시.
- `src/lib/sound.ts` — Web Audio 합성 효과음 19종 (파일 없음): tap/pick/hit(연사 제한)/kill/hurt/doorrun/pass/crash/treasure/legend/memory/lore/portal/bell/gift/over/enter/heartbeat/roar/unlock. phase 전환음은 App useEffect, 타격·통과음은 씬에서 직접 호출. 음소거: localStorage `d100-muted` + HUD·타이틀 🔊 버튼. `getAc()`로 AudioContext를 music.ts와 공유.
- `src/lib/music.ts` — **절차 생성 BGM** (파일 없음, 16분음표 스텝 시퀀서 + 룩어헤드 스케줄링): title(패드)/town(왈츠)/dungeon(깊이별 템포·옥타브 변화)/doorrun(질주)/boss(오스티나토 — 몬스터 아레나도 이 트랙). App useEffect가 phase·보스 생존·층 티어에 따라 트랙 전환. 음소거 토글 시 `music.sync()`.
- **보스 "페이지의 수호자"** (10층마다, DungeonScene) — 출구를 지키며 포털 봉인(처치 전 포털 숨김·비활성). 느린 추격 + 8방향 방사 탄막(eshots 풀) + 강한 접촉 피해. 처치 시 확정 보물 1개 + 회복 30 + 봉인 해제 연출. HUD에 보스 체력바. hp = 150+층×25. **주인공 자동 조준은 적뿐 아니라 보스도 대상**(예전엔 enemies만 봐서 일반 적을 다 치우면 보스를 못 쐈음 — 수정됨).
- **엔딩 (100층)** — 100층 출구는 황금 문. 접촉 시 `ending` phase: 혼자 나가기 / 촌장(작가)과 함께 나가기 선택 → 각각 다른 에필로그(story.ts ENDING_*) → 통계 화면. 100층에도 보스 있음(최종전 후 문).
- **기억 완성 보상** — 12번째 기억 회수 시 `memfull` phase: 아이템 2개 + 완전 회복.
- **위기 연출** — HP 30% 미만: 붉은 비네트 펄스 + 심장박동음(1초 간격).
- **인터랙티브 인트로** — STORY_NODES에 quiz 노드(책이 "7×8=?"을 물음, 정답/오답 모두 빨려 들어가는 개그). 배경 클릭 진행은 퀴즈 미답변 중 잠금.
- `src/lib/story.ts` — 인트로 슬라이드·회상 기억 12개(MEMORIES)·층별 벽의 글귀(getLore). **걸어다니는 마을 NPC 대화는 상황(TownContext: enter/visit/death)별 함수**로: `chiefTalk`(촌장 — 첫 입장 퀘스트·5층마다 세계관 회수·부활 격려), `ninaTalk`(니나 — 수프 회복, 부활 직후 '다시 쓰일 뿐'), `mukTalk`(무크 — 대장간 상점 진입), `entranceOptions`(던전 입구 — enter는 난이도 선택, 그 외는 이어서 내려가기). line 노드 `next<0`이면 대화 종료. **세계관: 던전=쓰이다 만 책, 마을=서문, 촌장=작가, 100층 문=뒤표지.** localStorage: `d100-story`(인트로 1회), `d100-mem`(되찾은 기억 수).
- 새 층 도착 시 `lore` phase로 벽의 글귀 1개 노출, 보물 획득 후 `memory` phase로 기억 1개 복원. 5의 배수 층엔 마을 문(dungeon.ts homeDoor) — 방문은 층 유지(townMode 'visit'), 문은 1회용(homeUsedRef), 거절 시 재무장(homeRetryRef). 몬스터는 5층 단위 티어로 모양·색 변화(DungeonScene ENEMY_TIER_*).
- `src/lib/rng.ts` — mulberry32 시드 난수. **층 번호 = 시드** → 같은 층은 항상 같은 구조 (재현성).
- `src/lib/upgrades.ts` — 스탯·보상 카드 풀. 드래프트는 `draftThree(rand)`, 보물 보상도 이 풀에서 지급.
- `src/lib/store.ts` — useLocalStorage 훅 (함수형 업데이트 지원). 키는 `d100-` 접두사: `d100-best`(최고 층), `d100-story`(인트로), `d100-mem`(기억), `d100-muted`(음소거), `d100-coins`(코인), `d100-meta`(영구 강화 {dmg,hp,spd}), `d100-deaths`(사망 횟수 — 죽음 로어 진행).
- **적 4타입** (DungeonScene): chaser(추격)/shooter(거리 유지+조준 사격, 3층+)/dasher(조준 후 돌진, 5층+)/tank(느리고 단단·넉백 면역·피해 1.5배, 7층+). 실루엣·색으로 구분(탱커 크고 어둡게, 슈터 작고 노랗게, 대셔 길쭉+조준 시 부들부들). 슈터 탄환은 보스 탄막 풀(eshots) 공유.
- **출구 수문장** (elite, DungeonScene) — 보스 없는 층(4층부터)의 **포털 문 앞을 지키는 정예** 1기. dasher AI를 재사용하되 더 넓은 어그로·빠른 접근·매서운 돌진, **넉백 면역**, 크고 진홍빛(전용 광원 eliteLightRef). 돌진 강타는 HP를 크게 깎고(`16+층×0.9`, 일반 접촉 `9+층×0.5`) 붉은 데미지 숫자로 보여줘 **깊이 내려갈수록 긴장감 유지**. hp `35+층×11`, 처치 코인 12. 포털을 봉인하진 않음(하드 게이트 X — 위험만 강조). DEV state에 `guardian` 노출.
- **메타 성장**: 처치 코인(일반 1, 탱커 3, 보스 25) → 마을 대장간(무크, phase `shop`)에서 영구 강화 구매 — 공격/생명/신속 단련 각 5레벨, 비용 (lv+1)×25. enterDungeon에서 시작 스탯에 반영. **코인·강화는 죽어도 유지.**
- **죽음 로어**: 사망할수록 "다시 쓰이고 있다"는 위화감이 커지는 문구(getDeathLore, 5단계+순환) — 게임오버 화면에 표시, 죽음=페이지가 넘어가는 것이라는 세계관과 연결.
- **부활 체크포인트** (App `checkpointFloor`): 5층 단위 마을 문에 들를 때마다(openHomeDoor) 그 층으로 갱신. 죽으면 1층이 아니라 **마지막 다녀온 마을에서 부활** — 게임오버 화면 "🏘️ N층 마을에서 다시 (장비 유지)" → 걸어다니는 마을(`goVillage('death')`)에서 니나·촌장이 맞아 줌 → 던전 입구로 걸어가 그 층부터 재개(**빌드·스탯 유지·완전 회복**, runId 증가로 씬 리마운트). 체크포인트<5(마을 미방문)면 기존처럼 "바로 다시 도전"(1층). enterDungeon에서 1로 초기화. '주인공은 다시 쓰일 뿐'이라는 죽음 로어 세계관과 직접 연결.
- **56층의 소녀 '여백'**: 작가가 쓰다 만 이름 없는 등장인물 (17층 글귀 회수). **복선 흔적**이 14(낙서)·28(종이학)·42(초대장)·49(찻잔)층에 오브젝트로 배치(TRACE_FLOORS, 접촉 시 `trace` phase 오버레이). 56층(GIRL_FLOOR)에서 만나면 대화(GIRL_SCRIPT, townMode 'girl'·전용 배경) — 아이템+차(완전 회복) 선물, 작가에게 전할 부탁. 만난 기록은 `d100-girl`, **엔딩에 한 장면 추가**(ENDING_GIRL_EXTRA). 소녀·흔적 주변은 몬스터 스폰 제외(28층 복선과 일치). 방문 선물은 노드당 1회(visitGiftGiven Set).
- `index.html` — `?rafshim` 심: 타이머 구동 rAF + ResizeObserver 폴링 폴리필 (숨김 탭 검증용 — 없으면 r3f가 부팅 못 함).

## 원칙
- UI 문구는 한국어. 백엔드 없음 — localStorage만.
- 외부 에셋 금지 — 절차 생성 지오메트리 + 캔버스/이모지 + Web Audio 합성으로 해결. 부득이 추가 시 출처·라이선스를 문서에 기록.
- 게임 로직은 렌더와 분리된 순수 함수 지향 (밸런스 자동 시뮬레이터가 로드맵에 있음 — 헤드리스로 돌릴 수 있어야 함).
- 커밋 기록이 심사 증빙 — 작업 단위마다 의미 있는 한국어 커밋 메시지로 커밋.

## 관련
- 자매작(원작): 두 문 러너 — https://github.com/Hakhyun-Kim/door-runner. 그 두 문 달리기가 이 게임의 보물상자 미니게임(DoorRunScene)으로 **통합 완료**. **제출작은 백층 던전으로 확정**(2026-07-13).
