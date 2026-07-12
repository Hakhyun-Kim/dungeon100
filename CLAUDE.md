# 백층 던전 (Dungeon 100)

매판 새로 생성되는 던전을 뚫고 100층까지 내려가는 **탑다운 3D 로그라이크** (three.js + react-three-fiber). 모바일 우선 웹앱 (React + Vite + TypeScript).
**공개 저장소** — NAN 2026 (NHN Game × AI Hackathon) 사전과제 투트랙 프로젝트. 시크릿·내부 경로 커밋 금지.
설계·로드맵: `docs/DESIGN.md` (주차별 계획 포함 — 작업 완료 시 체크 갱신).

## 문서 관리 원칙
- **작업을 마칠 때마다** 이 문서(구조·규칙 변경분)와 `docs/DESIGN.md`(체크리스트·시스템 설명)를 갱신할 것.
- 아래 "다음 후보" 섹션을 항상 최신으로 유지 — 끝낸 항목은 지우고, 새로 떠오른 아이디어를 우선순위와 함께 추가.

## 다음 후보 (우선순위)
1. **나침반/미니맵 + 데미지 숫자** — 탐험 편의(포털·상자 방향 표시)와 타격 피드백. 체감 개선 1순위.
2. **밸런스 자동 시뮬레이터** — `__pump`+`__d100fixdt` 하네스로 자동 봇 N판 → 사망 층 분포 리포트 (AI 활용 문서 하이라이트). 적 4타입·메타 성장이 생겨 밸런스 점검 필요성 커짐.
3. **처치 콤보** — 연속 처치 시 코인 배율(x2·x3), 콤보 이펙트 — 전투 몰입 + 코인 경제 연결.
4. **층 테마 색 변화** — 10층 단위 바닥·벽·안개 팔레트 교체 (절차 생성이라 저비용).
5. **모바일 진동** (navigator.vibrate) — 피격·처치·보물에 짧은 진동.
6. **게임오버 공유 카드** — 도달 층·처치·기억을 이미지로 (심사·바이럴용).
7. **제출 준비** — 플레이 영상 촬영(SUBMISSION.md 가이드), 문서 PDF 변환, 마감일 기입.

## 실행
- `npm install` — 최초 1회
- `npm run dev` — 개발 서버 (기본 포트 5175, `PORT` 환경변수로 변경 가능)
- `npm run typecheck` — 타입 검사
- `npm run build` — 프로덕션 빌드
- **디버그 층 이동: Shift+D** (Esc 닫기) — 빠른 버튼(1·5·10·…·100층) + 직접 입력, 이동 시 체력 회복. DEV에서는 항상, **배포판에서는 `?debug` 쿼리를 붙였을 때만** 활성화 (예: https://hakhyun-kim.github.io/dungeon100/?debug). 일반 `d`는 이동 키라 Shift 조합 사용.
- 숨김 탭(헤드리스 프리뷰)에서는 크롬이 rAF를 멈춰 3D가 안 그려짐 — `?rafshim` 쿼리로 우회 (index.html의 개발용 심: 타이머 rAF + ResizeObserver 폴리필 + **`window.__pump(n)` 동기 프레임 구동**). 크롬 집중 스로틀링(오래 숨겨진 탭, 타이머 분당 1회)에서는 타이머가 다 죽으므로 자동 검증은 `__pump` + `__d100fixdt`(고정 dt) + MessageChannel 틱(스로틀 안 됨)으로 구동할 것. 클릭 후 React 렌더는 태스크 경계가 필요 — 같은 evaluate 안에서는 MessageChannel 왕복(tick) 후 DOM을 읽어야 함. DEV 훅: `__d100`(teleport/state/hitBoss/killEnemies), `__d100run`(place/state), `__d100app`(jump — 층 점프). r3f 부팅은 클릭 루프보다 느릴 수 있으니 `window.__d100` 등장까지 넉넉히 대기할 것.
- 배포: main 푸시 → `.github/workflows/deploy-pages.yml` → https://hakhyun-kim.github.io/dungeon100/

## 구조
- `src/App.tsx` — phase 상태 머신: `title` → `story`(인트로, 최초 1회·건너뛰기 가능) → `town`(마을 대화·선택) → `run` → `doorrun`(보물상자 = 두 문 달리기, 최대 3라운드 푸시-유어-럭) → `quiz`(결과/계속 선택) / `portal`(다음 층 내려갈지 선택 — 거절 시 portalRetryRef 증가로 포털 재무장) → `draft`(보상 3택 1) → `run` / `over`(사망 → 재도전 or 마을). HUD·빌드 칩·오버레이는 캔버스 위 DOM. 사망 판정은 hp useEffect. Canvas는 run 계열 phase에만 마운트(배경·fog는 Canvas 레벨), 층 전환은 DungeonScene key 리마운트, 미니게임 라운드는 DoorRunScene key 리마운트. 미니게임 결과는 quizResultRef(seq 증가)로 던전 씬에 전달. 보상: 통과한 문 수 = 아이템 수, 3문 완주 = 전설(3개+완전회복), 중도 오답 = 전부 빈손.
- `src/three/DungeonScene.tsx` — 층 하나의 씬+시뮬레이션. 지형·적·투사체·파티클 전부 InstancedMesh. 시뮬레이션은 useFrame에서 ref 기반(React 상태는 onDamage/onKill/onExit/onChest 이벤트만). 타격감: 피격 흰색 번쩍(인스턴스 색)+넉백+스파크, 처치 폭발, 카메라 셰이크. 파워업 시각화: 멀티샷 궤도 구슬, 공격력별 투사체 크기·색, 체력별 몸집, 보물 획득 황금 잔광. 입력은 useMoveInput 훅 (키보드 + 터치 드래그, button 위에서는 시작 안 함). pausedRef로 퀴즈/드래프트/게임오버 중 정지. DEV 전용 `window.__d100`(teleport/state) — 자동 검증용.
- `src/lib/dungeon.ts` — 절차 생성. 방 흩뿌리기 + 폭 2 L자 복도 순차 연결(연결 보장). `GRID`=44셀, `CELL`=2. 충돌은 `canStand`(네 모서리 셀 검사). 시작 방 안전지대, 출구 인접 스폰 금지, 층당 보물상자 1개(시작·출구에서 떨어진 곳).
- `src/three/DoorRunScene.tsx` — **두 문 달리기 미니게임** (두 문 러너 인게임 재현). 자동 달리기 + 좌우 조작(useSteer: 화면 좌/우 꾹·←/→), 보라 게이트·유리 옆벽·문제판, 문 사이 벽 막힘, 몸으로 정답 문 통과 → onDone(true)·색종이 / 오답 💥 뒤로 넘어짐·정답 문 초록 표시 → onDone(false). 미니게임 동안 DungeonScene은 hidden(보임·카메라 양보). DEV 훅 `__d100run`(place/state), 시간 가속 `__d100speed`.
- `src/three/Hero.tsx` — 공용 주인공 블록 캐릭터 (던전·미니게임 세계관 통일).
- `src/three/textTexture.ts` — 한글 텍스트 → 캔버스 텍스처 (문제판·문 답, 두문러너 labels.ts 축소판).
- `src/lib/quiz.ts` — 미니게임 문제 생성. **던전 종류(DungeonMode: 'kids' 초등 / 'adult' 어른)** × 층 깊이로 난이도 결정 — kids: 한자리±→두자리±→곱셈구구→두자리×한자리 / adult: 두자리±→두자리×한자리→혼합→두자리×두자리. 근접 오답, 문제 은행 없음. 라운드 보정 +6/라운드. 던전 입구(마을 choice)에서 모드 선택, HUD에 🎒/🧠 표시.
- `src/lib/sound.ts` — Web Audio 합성 효과음 19종 (파일 없음): tap/pick/hit(연사 제한)/kill/hurt/doorrun/pass/crash/treasure/legend/memory/lore/portal/bell/gift/over/enter/heartbeat/roar/unlock. phase 전환음은 App useEffect, 타격·통과음은 씬에서 직접 호출. 음소거: localStorage `d100-muted` + HUD·타이틀 🔊 버튼. `getAc()`로 AudioContext를 music.ts와 공유.
- `src/lib/music.ts` — **절차 생성 BGM** (파일 없음, 16분음표 스텝 시퀀서 + 룩어헤드 스케줄링): title(패드)/town(왈츠)/dungeon(깊이별 템포·옥타브 변화)/doorrun(질주)/boss(오스티나토). App useEffect가 phase·보스 생존·층 티어에 따라 트랙 전환. 음소거 토글 시 `music.sync()`.
- **보스 "페이지의 수호자"** (10층마다, DungeonScene) — 출구를 지키며 포털 봉인(처치 전 포털 숨김·비활성). 느린 추격 + 8방향 방사 탄막(eshots 풀) + 강한 접촉 피해. 처치 시 확정 보물 1개 + 회복 30 + 봉인 해제 연출. HUD에 보스 체력바. hp = 150+층×25.
- **엔딩 (100층)** — 100층 출구는 황금 문. 접촉 시 `ending` phase: 혼자 나가기 / 촌장(작가)과 함께 나가기 선택 → 각각 다른 에필로그(story.ts ENDING_*) → 통계 화면. 100층에도 보스 있음(최종전 후 문).
- **기억 완성 보상** — 12번째 기억 회수 시 `memfull` phase: 아이템 2개 + 완전 회복.
- **위기 연출** — HP 30% 미만: 붉은 비네트 펄스 + 심장박동음(1초 간격).
- **인터랙티브 인트로** — STORY_NODES에 quiz 노드(책이 "7×8=?"을 물음, 정답/오답 모두 빨려 들어가는 개그). 배경 클릭 진행은 퀴즈 미답변 중 잠금.
- `src/lib/story.ts` — 인트로 슬라이드·마을 대화(line/choice 노드, gift='item'|'heal')·회상 기억 12개(MEMORIES)·층별 벽의 글귀(getLore)·5층마다 마을 방문 스크립트(townVisitScript). **세계관: 던전=쓰이다 만 책, 마을=서문, 촌장=작가, 100층 문=뒤표지.** localStorage: `d100-story`(인트로 1회), `d100-mem`(되찾은 기억 수).
- 새 층 도착 시 `lore` phase로 벽의 글귀 1개 노출, 보물 획득 후 `memory` phase로 기억 1개 복원. 5의 배수 층엔 마을 문(dungeon.ts homeDoor) — 방문은 층 유지(townMode 'visit'), 문은 1회용(homeUsedRef), 거절 시 재무장(homeRetryRef). 몬스터는 5층 단위 티어로 모양·색 변화(DungeonScene ENEMY_TIER_*).
- `src/lib/rng.ts` — mulberry32 시드 난수. **층 번호 = 시드** → 같은 층은 항상 같은 구조 (재현성).
- `src/lib/upgrades.ts` — 스탯·보상 카드 풀. 드래프트는 `draftThree(rand)`, 보물 보상도 이 풀에서 지급.
- `src/lib/store.ts` — useLocalStorage 훅 (함수형 업데이트 지원). 키는 `d100-` 접두사: `d100-best`(최고 층), `d100-story`(인트로), `d100-mem`(기억), `d100-muted`(음소거), `d100-coins`(코인), `d100-meta`(영구 강화 {dmg,hp,spd}), `d100-deaths`(사망 횟수 — 죽음 로어 진행).
- **적 4타입** (DungeonScene): chaser(추격)/shooter(거리 유지+조준 사격, 3층+)/dasher(조준 후 돌진, 5층+)/tank(느리고 단단·넉백 면역·피해 1.5배, 7층+). 실루엣·색으로 구분(탱커 크고 어둡게, 슈터 작고 노랗게, 대셔 길쭉+조준 시 부들부들). 슈터 탄환은 보스 탄막 풀(eshots) 공유.
- **메타 성장**: 처치 코인(일반 1, 탱커 3, 보스 25) → 마을 대장간(무크, phase `shop`)에서 영구 강화 구매 — 공격/생명/신속 단련 각 5레벨, 비용 (lv+1)×25. enterDungeon에서 시작 스탯에 반영. **코인·강화는 죽어도 유지.**
- **죽음 로어**: 사망할수록 "다시 쓰이고 있다"는 위화감이 커지는 문구(getDeathLore, 5단계+순환) — 게임오버 화면에 표시, 죽음=페이지가 넘어가는 것이라는 세계관과 연결.
- **56층의 소녀 '여백'**: 작가가 쓰다 만 이름 없는 등장인물 (17층 글귀 회수). **복선 흔적**이 14(낙서)·28(종이학)·42(초대장)·49(찻잔)층에 오브젝트로 배치(TRACE_FLOORS, 접촉 시 `trace` phase 오버레이). 56층(GIRL_FLOOR)에서 만나면 대화(GIRL_SCRIPT, townMode 'girl'·전용 배경) — 아이템+차(완전 회복) 선물, 작가에게 전할 부탁. 만난 기록은 `d100-girl`, **엔딩에 한 장면 추가**(ENDING_GIRL_EXTRA). 소녀·흔적 주변은 몬스터 스폰 제외(28층 복선과 일치). 방문 선물은 노드당 1회(visitGiftGiven Set).
- `index.html` — `?rafshim` 심: 타이머 구동 rAF + ResizeObserver 폴링 폴리필 (숨김 탭 검증용 — 없으면 r3f가 부팅 못 함).

## 원칙
- UI 문구는 한국어. 백엔드 없음 — localStorage만.
- 외부 에셋 금지 — 절차 생성 지오메트리 + 캔버스/이모지 + Web Audio 합성으로 해결. 부득이 추가 시 출처·라이선스를 문서에 기록.
- 게임 로직은 렌더와 분리된 순수 함수 지향 (밸런스 자동 시뮬레이터가 로드맵에 있음 — 헤드리스로 돌릴 수 있어야 함).
- 커밋 기록이 심사 증빙 — 작업 단위마다 의미 있는 한국어 커밋 메시지로 커밋.

## 관련
- 자매 프로젝트(같은 해커톤 투트랙): 두 문 러너 — https://github.com/Hakhyun-Kim/door-runner (제출 안전판). 마감 1주 전 둘 중 제출작 선택.
