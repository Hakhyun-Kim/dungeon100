# 백층 던전 (Dungeon 100)

매판 새로 생성되는 던전을 뚫고 100층까지 내려가는 **탑다운 3D 로그라이크** (three.js + react-three-fiber). 모바일 우선 웹앱 (React + Vite + TypeScript).
**공개 저장소** — NAN 2026 (NHN Game × AI Hackathon) 사전과제 투트랙 프로젝트. 시크릿·내부 경로 커밋 금지.
설계·로드맵: `docs/DESIGN.md` (주차별 계획 포함 — 작업 완료 시 체크 갱신).

## 실행
- `npm install` — 최초 1회
- `npm run dev` — 개발 서버 (기본 포트 5175, `PORT` 환경변수로 변경 가능)
- `npm run typecheck` — 타입 검사
- `npm run build` — 프로덕션 빌드
- 숨김 탭(헤드리스 프리뷰)에서는 크롬이 rAF를 멈춰 3D가 안 그려짐 — `?rafshim` 쿼리로 우회 (index.html의 개발용 심).
- 배포: main 푸시 → `.github/workflows/deploy-pages.yml` → https://hakhyun-kim.github.io/dungeon100/

## 구조
- `src/App.tsx` — phase 상태 머신: `title` → `story`(인트로, 최초 1회·건너뛰기 가능) → `town`(마을 대화·선택) → `run` → `doorrun`(보물상자 = 두 문 달리기, 최대 3라운드 푸시-유어-럭) → `quiz`(결과/계속 선택) / `portal`(다음 층 내려갈지 선택 — 거절 시 portalRetryRef 증가로 포털 재무장) → `draft`(보상 3택 1) → `run` / `over`(사망 → 재도전 or 마을). HUD·빌드 칩·오버레이는 캔버스 위 DOM. 사망 판정은 hp useEffect. Canvas는 run 계열 phase에만 마운트(배경·fog는 Canvas 레벨), 층 전환은 DungeonScene key 리마운트, 미니게임 라운드는 DoorRunScene key 리마운트. 미니게임 결과는 quizResultRef(seq 증가)로 던전 씬에 전달. 보상: 통과한 문 수 = 아이템 수, 3문 완주 = 전설(3개+완전회복), 중도 오답 = 전부 빈손.
- `src/three/DungeonScene.tsx` — 층 하나의 씬+시뮬레이션. 지형·적·투사체·파티클 전부 InstancedMesh. 시뮬레이션은 useFrame에서 ref 기반(React 상태는 onDamage/onKill/onExit/onChest 이벤트만). 타격감: 피격 흰색 번쩍(인스턴스 색)+넉백+스파크, 처치 폭발, 카메라 셰이크. 파워업 시각화: 멀티샷 궤도 구슬, 공격력별 투사체 크기·색, 체력별 몸집, 보물 획득 황금 잔광. 입력은 useMoveInput 훅 (키보드 + 터치 드래그, button 위에서는 시작 안 함). pausedRef로 퀴즈/드래프트/게임오버 중 정지. DEV 전용 `window.__d100`(teleport/state) — 자동 검증용.
- `src/lib/dungeon.ts` — 절차 생성. 방 흩뿌리기 + 폭 2 L자 복도 순차 연결(연결 보장). `GRID`=44셀, `CELL`=2. 충돌은 `canStand`(네 모서리 셀 검사). 시작 방 안전지대, 출구 인접 스폰 금지, 층당 보물상자 1개(시작·출구에서 떨어진 곳).
- `src/three/DoorRunScene.tsx` — **두 문 달리기 미니게임** (두 문 러너 인게임 재현). 자동 달리기 + 좌우 조작(useSteer: 화면 좌/우 꾹·←/→), 보라 게이트·유리 옆벽·문제판, 문 사이 벽 막힘, 몸으로 정답 문 통과 → onDone(true)·색종이 / 오답 💥 뒤로 넘어짐·정답 문 초록 표시 → onDone(false). 미니게임 동안 DungeonScene은 hidden(보임·카메라 양보). DEV 훅 `__d100run`(place/state), 시간 가속 `__d100speed`.
- `src/three/Hero.tsx` — 공용 주인공 블록 캐릭터 (던전·미니게임 세계관 통일).
- `src/three/textTexture.ts` — 한글 텍스트 → 캔버스 텍스처 (문제판·문 답, 두문러너 labels.ts 축소판).
- `src/lib/quiz.ts` — 미니게임 문제 생성. 층 깊이 비례 난이도의 산수 문제 + 근접 오답, 문제 은행 없음. 미니게임 라운드가 깊어질수록 난이도 상향(층 환산 +6/라운드).
- `src/lib/story.ts` — 인트로 슬라이드·마을 대화 스크립트 (line/choice 노드 배열, next 인덱스로 분기·루프). 첫 방문(TOWN_FIRST)과 재방문(TOWN_REVISIT) 분리. localStorage `d100-story`로 인트로 1회 노출.
- `src/lib/rng.ts` — mulberry32 시드 난수. **층 번호 = 시드** → 같은 층은 항상 같은 구조 (재현성).
- `src/lib/upgrades.ts` — 스탯·보상 카드 풀. 드래프트는 `draftThree(rand)`, 보물 보상도 이 풀에서 지급.
- `src/lib/store.ts` — useLocalStorage 훅. 키는 `d100-` 접두사 (`d100-best`).
- `index.html` — `?rafshim` 심: 타이머 구동 rAF + ResizeObserver 폴링 폴리필 (숨김 탭 검증용 — 없으면 r3f가 부팅 못 함).

## 원칙
- UI 문구는 한국어. 백엔드 없음 — localStorage만.
- 외부 에셋 금지 — 절차 생성 지오메트리 + 캔버스/이모지 + Web Audio 합성으로 해결. 부득이 추가 시 출처·라이선스를 문서에 기록.
- 게임 로직은 렌더와 분리된 순수 함수 지향 (밸런스 자동 시뮬레이터가 로드맵에 있음 — 헤드리스로 돌릴 수 있어야 함).
- 커밋 기록이 심사 증빙 — 작업 단위마다 의미 있는 한국어 커밋 메시지로 커밋.

## 관련
- 자매 프로젝트(같은 해커톤 투트랙): 두 문 러너 — https://github.com/Hakhyun-Kim/door-runner (제출 안전판). 마감 1주 전 둘 중 제출작 선택.
