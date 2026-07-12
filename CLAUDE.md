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
- `src/App.tsx` — phase 상태 머신: `title` → `run` → `quiz`(보물상자 수수께끼) / `draft`(층 클리어, 보상 3택 1) → `run` / `over`(사망). HUD·빌드 칩·오버레이는 캔버스 위 DOM. 사망 판정은 hp useEffect. Canvas는 런 내내 유지, 층 전환은 DungeonScene key 리마운트. 퀴즈 결과는 quizResultRef(seq 증가)로 씬에 전달.
- `src/three/DungeonScene.tsx` — 층 하나의 씬+시뮬레이션. 지형·적·투사체·파티클 전부 InstancedMesh. 시뮬레이션은 useFrame에서 ref 기반(React 상태는 onDamage/onKill/onExit/onChest 이벤트만). 타격감: 피격 흰색 번쩍(인스턴스 색)+넉백+스파크, 처치 폭발, 카메라 셰이크. 파워업 시각화: 멀티샷 궤도 구슬, 공격력별 투사체 크기·색, 체력별 몸집, 보물 획득 황금 잔광. 입력은 useMoveInput 훅 (키보드 + 터치 드래그, button 위에서는 시작 안 함). pausedRef로 퀴즈/드래프트/게임오버 중 정지. DEV 전용 `window.__d100`(teleport/state) — 자동 검증용.
- `src/lib/dungeon.ts` — 절차 생성. 방 흩뿌리기 + 폭 2 L자 복도 순차 연결(연결 보장). `GRID`=44셀, `CELL`=2. 충돌은 `canStand`(네 모서리 셀 검사). 시작 방 안전지대, 출구 인접 스폰 금지, 층당 보물상자 1개(시작·출구에서 떨어진 곳).
- `src/lib/quiz.ts` — 보물상자 수수께끼 생성 (두 문 러너 크로스오버). 층 깊이 비례 난이도의 산수 문제 + 근접 오답, 문제 은행 없음.
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
