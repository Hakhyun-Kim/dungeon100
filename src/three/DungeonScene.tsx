// 던전 한 층의 씬 + 시뮬레이션 — 이 프로젝트에서 가장 큰 파일이라 먼저 지도부터.
//
//   ~220줄   데이터·지오메트리   적/투사체/보스 타입, 10층 단위 테마(DUNGEON_THEMES),
//                                몬스터 실루엣 조립(buildEnemyGeometry — 티어=몸통, 타입=기능 부위)
//   ~220줄~  DungeonScene 본체
//              · refs        상태는 전부 ref다. React 상태는 onDamage/onKill/onExit/onChest
//                            **이벤트만** — 매 프레임 setState를 하면 r3f가 못 버틴다.
//              · 헬퍼 클로저 burst/impact/spawnDmg/killEnemy … (씬 안 상태를 잡고 있어 밖으로 못 뺀다)
//              · useFrame    한 프레임: 입력 → 이동 → 발사 → 적 AI → 보스 → 충돌 → 연출.
//                            `pausedRef`가 true면 시뮬레이션 블록을 통째로 건너뛴다.
//              · JSX         전부 InstancedMesh (바닥·벽·적·투사체·파티클)
//   ~2760줄~ 입력 훅          useMoveInput(가상 조이스틱)·useChargeInput(차지 샷)·useFreezeInput(찰나)
//                            ·useResolveInput(결의, 2026-07-29) — 마을·아레나 씬도 같은 훅을 재사용한다.
//
// 규칙 둘: ①인스턴스 개수는 마운트 때 고정되므로 나중에 늘어날 것(보스 소환·증원)은 **예비 슬롯을
// 미리 잡아 둔다** ②연출용 값(reveal·shake·flash)은 시뮬레이션에 되먹이지 않는다 — 봇 검증이 흔들린다.
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, canStand, cellToWorld, forkSpot, generateFloor, GRID, isFloor } from '../lib/dungeon';
import type { Stats } from '../lib/upgrades';
import { appRotation } from '../lib/rotate';
import { chargeHum, sfx } from '../lib/sound';
import { music } from '../lib/music';
import Hero, { type HeroVariant } from './Hero';
import { BlobShadow, getBlobShadowTexture, getFloorTexture, getWallTexture } from './fx';
import type { MiniMapChannel } from '../ui/MiniMap';
import { trackAbilityUse } from '../lib/analytics';

// 셀 좌표 → 결정적 0..1 해시 (타일 색 변주·가짜 AO용 — 시드 고정이라 같은 층은 항상 같은 무늬)
const cellHash = (x: number, y: number, s: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

// 층 하나의 3D 씬 + 시뮬레이션. 층이 바뀌면 부모가 key로 리마운트한다.
// 적 타입: chaser(추격) / shooter(원거리 견제) / dasher(조준 후 돌진) / tank(느리고 단단)
type EType = 'chaser' | 'shooter' | 'dasher' | 'tank';

interface Enemy {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  hitCd: number;
  wobble: number;
  flash: number; // 피격 시 1 → 0으로 감쇠 (흰색 번쩍)
  type: EType;
  ai: number; // 타입별 타이머 (발사 쿨다운, 돌진 단계 시간 등)
  mode: number; // dasher: 0 접근 / 1 조준 / 2 돌진 / 3 숨 고르기
  adx: number; // 돌진 방향
  adz: number;
  elite: boolean; // 출구 수문장 — 크고 강하게 돌진하는 정예 (보스 없는 층의 문지기)
}

function pickEnemyType(floorNo: number): EType {
  const r = Math.random();
  const d = Math.min(1, floorNo / 30); // 깊이 계수 — 내려갈수록 위험한 타입 비중 상승
  if (floorNo >= 2 && r < 0.2 + d * 0.08) return 'shooter';
  if (floorNo >= 4 && r < 0.38 + d * 0.1) return 'dasher';
  if (floorNo >= 6 && r < 0.52 + d * 0.1) return 'tank';
  return 'chaser';
}

interface Shot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number; // 남은 사거리
  pierce: number; // 남은 관통 횟수 (관통 서표)
  bounce: number; // 남은 벽 반사 횟수 (진화 「종이 표창」)
  last: number; // 마지막으로 맞힌 적 인덱스 (관통탄 연속 타격 방지)
  charge: number; // 차지 샷 배율 (0 = 평타) — 피해·크기·타격 연출에 함께 쓰인다
  alive: boolean;
}

// 10층마다 등장하는 보스 "페이지의 수호자" — 10층 주기로 패턴이 순환한다 (2026-07-24):
// radial(방사 탄막·기본) → summon(죽은 몬스터를 '다시 쓴다') → charge(조준 돌진 + 착지 링)
type BossVariant = 'radial' | 'summon' | 'charge';
const bossVariantOf = (floorNo: number): BossVariant =>
  (['radial', 'summon', 'charge'] as const)[(Math.floor(floorNo / 10) - 1) % 3];

interface Boss {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  hitCd: number;
  fireTimer: number;
  flash: number;
  mode: number; // charge: 0 추격 / 1 조준 / 2 돌진 / 3 숨 고르기
  ai: number; // 단계 타이머
  adx: number; // 돌진 방향
  adz: number;
  volley: number; // summon: 격발 횟수 (2회마다 소환)
}

interface EShot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number;
  alive: boolean;
}

const MAX_ESHOTS = 64; // 슈터 연사 강화 + 보스 탄막 확대에 맞춰 풀 확장
const ESHOT_SPEED = 6.5;

// ── 찰나(시간 동결, 2026-07-27) — 처치로 채우는 1회성 자원. 발동하면 적·탄막·보스만
// 세계 시간이 멎고 주인공은 그대로 움직인다("나만 시간이 흐른다"). '자원'을 처치 게이지로
// 잡은 게 핵심 — 파밍이 아니라 전투 리듬 자체가 자원이 된다.
const FREEZE_KILLS = 6; // 게이지를 채우는 데 필요한 처치 수
const FREEZE_DURATION = 1.1; // 발동 지속 시간(초)

// ── 저항하는 정예 (2026-07-31) — 찰나에 카운터플레이를 준다. 예전엔 누르면 100% 안전한
// 버튼이라 판단이 필요 없었다. 출구 수문장(정예)은 찰나에 안 얼고(worldDt로 계속 움직임),
// 얼어붙은 채로 맞으면 남은 찰나 지속 시간을 이만큼 깎는다 — "정예 근처에서 얼려도
// 안전하지 않다"는 실시간 판단을 만든다.
const FREEZE_STEAL = 0.35; // 정예에게 맞을 때 깎이는 남은 찰나 지속 시간(초)

// ── 결의(무적 대시, 2026-07-29) — 찰나와 짝을 이루는 두 번째 처치 게이지지만 방향이 반대다.
// 찰나는 "세계를 멈추고 여유를 산다"(공격 리듬), 결의는 "짧게 무적으로 뚫고 지나간다"(회피 판단).
// 이 게임엔 실시간 회피 판단이 없었으므로(회피는 드래프트 패시브 확률뿐) 새로 만들었다 —
// 찰나와 혼동되지 않게 별개의 ref·버튼·키로 완전히 분리한다.
// export — GemArenaScene도 같은 상수·훅을 재사용한다(useMoveInput 재사용과 같은 패턴)
export const RESOLVE_KILLS = 4; // 게이지를 채우는 데 필요한 처치 수 (찰나보다 짧게 — 방어 자원은 더 자주 쥐어야 한다)
export const RESOLVE_DASH_DURATION = 0.4; // 무적 대시 지속 시간(초)
export const RESOLVE_DASH_SPEED = 16; // 대시 이동 속도 (이동 소프트 캡 12보다 확실히 빠르게)

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ttl: number;
  max: number;
  size: number;
  alive: boolean;
  color: THREE.Color;
}

export interface QuizResult {
  seq: number;
  ok: boolean;
}

const MAX_SHOTS = 48;
const MAX_PARTICLES = 160;
const SHOT_SPEED = 15;
const AGGRO = 9;

// 5층 단위로 몬스터의 색과 모양이 바뀐다 (티어)
const ENEMY_TIER_COLORS = ['#ff5d7e', '#7be07a', '#5aa0ff', '#c06bff', '#ffa03d', '#8de0e0'];
const ENEMY_TIER_EMISSIVE = ['#5c1024', '#124d18', '#10315c', '#3c1060', '#5c3a10', '#105050'];

// ── 10층 단위 던전 테마 — 깊이 = 이야기의 진행. 바닥·벽 팔레트가 바뀌고,
//    App이 dungeonTheme(floorNo).bg로 배경·안개색을 맞추며 깊을수록 안개를 짙게 한다.
export interface DungeonTheme {
  f1: string; // 바닥 체커 밝은 칸
  f2: string; // 바닥 체커 어두운 칸
  wall: string;
  bg: string; // 배경·안개색 (App Canvas)
}
export const DUNGEON_THEMES: DungeonTheme[] = [
  { f1: '#3a2f55', f2: '#453a63', wall: '#251c3d', bg: '#140e22' }, // 1~10 보랏빛 서장
  { f1: '#2f4a44', f2: '#3a5850', wall: '#1c332c', bg: '#0e1a16' }, // 11~20 이끼 낀 페이지
  { f1: '#4d3a30', f2: '#5a463a', wall: '#33241c', bg: '#1a120e' }, // 21~30 가을 잉크
  { f1: '#2f3a55', f2: '#3a4663', wall: '#1c2540', bg: '#0e1224' }, // 31~40 푸른 밤
  { f1: '#3a4a5c', f2: '#46586a', wall: '#243440', bg: '#101a20' }, // 41~50 서리 내린 행간
  { f1: '#4a2f44', f2: '#583a52', wall: '#33202e', bg: '#180e16' }, // 51~60 장미 잉크 (56층 소녀)
  { f1: '#4a332f', f2: '#57403a', wall: '#33211c', bg: '#170f0d' }, // 61~70 녹슨 철문
  { f1: '#3d3d44', f2: '#4a4a52', wall: '#28282e', bg: '#121216' }, // 71~80 잿빛 침묵
  { f1: '#4a2530', f2: '#57303a', wall: '#331821', bg: '#170a0e' }, // 81~90 핏빛 절정
  { f1: '#4a3f2a', f2: '#5a4d34', wall: '#332a18', bg: '#171208' }, // 91~100 금빛 마지막 장
];
export const dungeonTheme = (floorNo: number) =>
  DUNGEON_THEMES[Math.max(0, Math.min(DUNGEON_THEMES.length - 1, Math.floor((floorNo - 1) / 10)))];

// ── 몬스터 실루엣 (2026-07-26)
// 예전엔 층 티어 도형 하나를 색·크기로만 바꿔 써서, 네 타입이 전부 비슷해 보였다.
// "무엇을 하는 놈인지"가 실루엣으로 읽혀야 긴장이 생긴다 — 주인공이 던전 종류에 따라
// 모습을 바꾸듯, 적도 **기능에 따라** 형태를 갖는다. 외부 에셋 없이 원시 도형을 합쳐 만든다.
//   층 티어 = 몸통(코어) 모양·색   ×   타입 = 몸에 붙는 기능 부위
function tierCore(tier: number): THREE.BufferGeometry {
  switch (tier) {
    case 1: return new THREE.OctahedronGeometry(0.62);
    case 2: return new THREE.ConeGeometry(0.55, 1.05, 6);
    case 3: return new THREE.DodecahedronGeometry(0.6);
    case 4: return new THREE.CylinderGeometry(0.42, 0.62, 0.95, 7);
    case 5: return new THREE.IcosahedronGeometry(0.62);
    default: return new THREE.BoxGeometry(0.9, 0.9, 0.9);
  }
}

export type EnemyKind = 'chaser' | 'shooter' | 'dasher' | 'tank' | 'elite';

// +Z가 '앞'(주인공을 바라보는 쪽) — 씬이 매 프레임 적을 진행 방향으로 돌려 세운다.
function buildEnemyGeometry(kind: EnemyKind, tier: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // three의 다면체(Octahedron·Dodecahedron·Icosahedron·Cone)는 non-indexed인데
  // Box·Cylinder·Sphere는 indexed다 — 섞어서 병합하면 실패한다. 전부 non-indexed로 맞춘다.
  const flat = (g: THREE.BufferGeometry) => {
    if (!g.index) return g;
    const n = g.toNonIndexed();
    g.dispose();
    return n;
  };
  const core = flat(tierCore(tier));
  const push = (g0: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0) => {
    const g = flat(g0);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    parts.push(g);
  };
  // ⚠️ 크기는 씬의 타입별 스케일(sx/sy/sz)이 이미 정한다 — 여기서 코어를 또 줄이면
  // 이중 적용이 되어 슈터·대셔가 눈에 안 띌 만큼 작아진다(실측으로 확인). 모양만 담당한다.
  parts.push(core);
  if (kind === 'shooter') {
    // 겨누는 것 — 앞으로 뻗은 포신 + 외눈. 멀리서도 "쏘는 놈"으로 읽혀야 한다.
    push(new THREE.CylinderGeometry(0.14, 0.18, 0.85, 6), 0, 0.02, 0.55, Math.PI / 2);
    push(new THREE.SphereGeometry(0.22, 8, 8), 0, 0.3, 0.22);
  } else if (kind === 'dasher') {
    // 덮치는 것 — 앞이 뾰족한 쐐기 + 뒤로 젖혀진 지느러미. 방향이 곧 '돌진'을 말한다.
    push(new THREE.ConeGeometry(0.34, 0.9, 4), 0, 0, 0.66, Math.PI / 2);
    push(new THREE.BoxGeometry(0.09, 0.5, 0.42), -0.3, 0.24, -0.34);
    push(new THREE.BoxGeometry(0.09, 0.5, 0.42), 0.3, 0.24, -0.34);
  } else if (kind === 'tank') {
    // 무거운 것 — 어깨 블록 + 등판. 낮고 넓어 '안 밀린다'가 보인다.
    push(new THREE.BoxGeometry(0.34, 0.5, 0.58), -0.56, 0.1, 0);
    push(new THREE.BoxGeometry(0.34, 0.5, 0.58), 0.56, 0.1, 0);
    push(new THREE.BoxGeometry(1.0, 0.2, 0.7), 0, 0.52, 0);
  } else if (kind === 'elite') {
    // 출구 수문장 — 뿔 두 개 + 어깨. 문 앞에 선 것만으로 위압이 되게.
    push(new THREE.ConeGeometry(0.16, 0.62, 5), -0.3, 0.72, 0);
    push(new THREE.ConeGeometry(0.16, 0.62, 5), 0.3, 0.72, 0);
    push(new THREE.BoxGeometry(0.3, 0.34, 0.48), -0.62, 0.18, 0);
    push(new THREE.BoxGeometry(0.3, 0.34, 0.48), 0.62, 0.18, 0);
  } else {
    // 쫓는 것 — 기본형에 작은 뿔만. 첫 페이지의 몬스터답게 가장 읽기 쉽게.
    push(new THREE.ConeGeometry(0.13, 0.34, 4), -0.22, 0.55, 0);
    push(new THREE.ConeGeometry(0.13, 0.34, 4), 0.22, 0.55, 0);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged ?? core;
}

function DungeonScene({
  floorNo,
  seedOffset = 0,
  hidden,
  heroVariant,
  minimapRef,
  lite = false,
  danger = false,
  fork = false,
  statsRef,
  damageMulRef,
  pausedRef,
  quizResultRef,
  homeRetryRef,
  homeUsedRef,
  altarRetryRef,
  altarUsedRef,
  secretRetryRef,
  riftRetryRef,
  riftGoRef,
  collapseRetryRef,
  collapseUsedRef,
  rushRef,
  evoFxRef,
  onDamage,
  onHeal,
  onKill,
  onExit,
  onChest,
  onHomeDoor,
  onBossHp,
  onBossDown,
  onTrace,
  onGirl,
  onAltar,
  onSecret,
  onRift,
  onCollapse,
  onSurge,
  onCoins,
  onHouseBuff,
}: {
  floorNo: number;
  seedOffset?: number; // 일일 던전 — 날짜 시드를 층 시드에 섞는다 (0 = 보통 던전)
  hidden: boolean; // 두 문 달리기 미니게임 동안 던전을 숨기고 카메라를 양보
  heroVariant?: HeroVariant; // 던전 종류에 따른 주인공 모습 (초등학생/대학생/모험가)
  minimapRef?: React.MutableRefObject<MiniMapChannel>; // 미니맵 채널 — 프레임마다 좌표·탐사 마스크를 써 넣는다
  lite?: boolean; // ⚡가벼움 모드 — 텍스처·범프 없이 플랫 재질 (기존 렌더 경로)
  danger?: boolean; // 갈림길 「모험의 길」 계약 층 — 스폰 1.5배·받는 피해 1.25배
  fork?: boolean; // 이 층에 갈림길이 열렸는가 — 출구 곁에 붉은 포털을 하나 더 놓는다
  statsRef: React.MutableRefObject<Stats>;
  /** 기억 능력 '두근거림' 등 상황형 공격 배율 (1 = 없음) */
  damageMulRef: React.MutableRefObject<number>;
  pausedRef: React.MutableRefObject<boolean>;
  quizResultRef: React.MutableRefObject<QuizResult | null>;
  homeRetryRef: React.MutableRefObject<number>; // 마을 문 "나중에" 선택 시 증가 → 문 재무장
  homeUsedRef: React.MutableRefObject<number>; // 마을 방문 완료 시 증가 → 문 소멸
  altarRetryRef: React.MutableRefObject<number>; // 제단 "그만둔다" → 재무장
  altarUsedRef: React.MutableRefObject<number>; // 제단에 바침 → 제단 소멸
  secretRetryRef: React.MutableRefObject<number>; // 찢어진 페이지 "그만둔다" → 재무장
  riftRetryRef: React.MutableRefObject<number>; // 두 갈래 틈 "그만둔다" → 벗어나면 재무장
  riftGoRef: React.MutableRefObject<number>; // 두 갈래 틈 "들어간다" → 반대편으로 순간이동
  collapseRetryRef: React.MutableRefObject<number>; // 무너지는 서가 "그만둔다" → 벗어나면 재무장
  collapseUsedRef: React.MutableRefObject<number>; // 서가를 흔듦 → 서가 붕괴 + 역류 시작
  rushRef: React.MutableRefObject<boolean>; // 역류 진행 중 — 미니맵이 출구를 밝히고 굉음이 인다
  evoFxRef?: React.MutableRefObject<number>; // 진화 「합본」 획득 순간 — 대형 연출 트리거 (seq 증가)
  onDamage: (dmg: number) => void;
  onHeal: (amount: number) => void; // 흡혈의 잉크 — 처치 시 회복
  onKill: (bounty: number, kind?: string) => void; // bounty = 코인 (탱커 3, 그 외 1), kind = 도감 기록용 종류
  onExit: (danger?: boolean) => void; // danger = 붉은 포털(🔥 모험의 길)로 내려갔다
  onChest: () => void;
  onHomeDoor: () => void;
  onBossHp: (hp: number, maxHp: number) => void;
  onBossDown: () => void;
  onTrace: () => void; // 소녀의 흔적 발견
  onGirl: () => void; // 56층 소녀와 만남
  onAltar: () => void; // 제단 접촉 → 바칠지 선택
  onSecret: () => void; // 찢어진 페이지 접촉 → 건너뛸지 선택
  onRift: () => void; // 두 갈래 틈 접촉 → 들어갈지 선택
  onCollapse: () => void; // 무너지는 서가 접촉 → 흔들지 선택
  onSurge: (seconds: number) => void; // 「마지막 문단」 시작(초)·해소(0) — HUD 배너·비네트용
  onCoins: (n: number) => void; // 몬스터 하우스 코인 무더기 줍기
  onHouseBuff: (n: number) => void; // 몬스터 하우스 코인 무더기 1·2번째 — 이번 층 한정 버프 2택 1
}) {
  const floor = useMemo(() => generateFloor(floorNo, seedOffset), [floorNo, seedOffset]);
  const isBossFloor = floorNo % 10 === 0;
  const input = useMoveInput(pausedRef);
  const chargeHeld = useChargeInput(pausedRef);
  const charge = useRef(0); // 0~1 — 모으는 중인 힘
  const chargeShotRef = useRef(0); // 놓은 순간의 세기 — 다음 발사 틱이 소비한다
  const chargeRingRef = useRef<THREE.Mesh>(null);
  const chargeFullRef = useRef(false); // 완충 신호음을 한 번만 울리기 위한 래치
  // 층을 옮기거나(리마운트) 게임이 끝나도 허밍은 반드시 회수한다
  useEffect(() => () => chargeHum.stop(), []);

  // ── 찰나(시간 동결) — n/FREEZE_KILLS 처치 게이지, ready면 버튼 탭(또는 F키)으로 발동
  const freezeUiRef = useRef({ n: 0, ready: false });
  const freezeTrigger = useFreezeInput(pausedRef, freezeUiRef);
  const freezeActiveRef = useRef(0); // 남은 발동 시간(초), >0이면 적 세계가 얼어 있다

  // ── 결의(무적 대시) — n/RESOLVE_KILLS 처치 게이지, ready면 버튼 탭(또는 R키)으로 발동.
  // 찰나와 완전히 분리된 상태(별도 ref·훅·버튼) — 같은 처치 이벤트가 두 게이지를 동시에 채운다.
  const resolveUiRef = useRef({ n: 0, ready: false });
  const resolveTrigger = useResolveInput(pausedRef, resolveUiRef);
  const resolveActiveRef = useRef(0); // 남은 대시 시간(초), >0이면 무적+자동발사 정지
  const resolveDirRef = useRef({ x: 0, z: 1 }); // 발동 순간 고정한 돌진 방향

  const playerRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const orbs = useRef<(THREE.Mesh | null)[]>([null, null, null, null]);
  const portalRef = useRef<THREE.Group>(null);
  const chestRef = useRef<THREE.Group>(null);
  const floorMeshRef = useRef<THREE.InstancedMesh>(null);
  const wallMeshRef = useRef<THREE.InstancedMesh>(null);
  // 타입별 메시 — 한 지오메트리로 전부 그리면 실루엣이 안 갈린다.
  // 프레임마다 타입별로 나눠 담고 count를 조절한다 (드로우콜 5개, 인스턴싱 유지).
  const enemyKindRefs = useRef<Record<EnemyKind, THREE.InstancedMesh | null>>({
    chaser: null, shooter: null, dasher: null, tank: null, elite: null,
  });
  const enemyShadowRef = useRef<THREE.InstancedMesh>(null); // 적 발밑 블롭 섀도우
  const bossShadowRef = useRef<THREE.Mesh>(null);
  const shotMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);

  const enemies = useRef<Enemy[]>(
    (() => {
      // 깊은 층 적 스탯 램프 (2026-07-25) — 기존 램프는 '받는 피해'만 올려서, 적은 여전히
      // 순삭당하고 층은 의미를 잃었다(사람형 봇 50층 무사·195아이템). 적 HP도 깊이에 따라
      // 초선형으로 올려 '주인공이 강해진 만큼 적도 단단해지게' 한다.
      // 25층까지는 계수 1 — 얕은 층 체감은 예전 그대로.
      const depthMul = 1 + Math.pow(Math.max(0, floorNo - 25) / 25, 2) * 2.5;
      const baseHp = (18 + floorNo * 7) * depthMul;
      const list: Enemy[] = floor.spawns.map((s) => {
        const [wx, wz] = cellToWorld(s.x, s.y);
        const type = pickEnemyType(floorNo);
        return {
          x: wx,
          z: wz,
          hp: type === 'tank' ? baseHp * 2.8 : type === 'shooter' ? baseHp * 0.8 : baseHp,
          alive: true,
          hitCd: 0,
          wobble: Math.random() * 6,
          flash: 0,
          type,
          ai: Math.random() * 1.5,
          mode: 0,
          adx: 0,
          adz: 0,
          elite: false,
        };
      });
      // 소환형 보스 층 — '다시 쓰일' 예비 슬롯을 미리 만들어 둔다
      // (InstancedMesh 개수는 마운트 시 고정이라, 소환 = 죽은 슬롯을 되살리는 방식)
      if (isBossFloor && bossVariantOf(floorNo) === 'summon') {
        const [ex2, ez2] = cellToWorld(floor.exit.x, floor.exit.y);
        for (let k = 0; k < 12; k++) {
          list.push({
            x: ex2, z: ez2, hp: 0, alive: false, hitCd: 0, wobble: Math.random() * 6,
            flash: 0, type: 'chaser', ai: 0, mode: 0, adx: 0, adz: 0, elite: false,
          });
        }
      }
      // 「마지막 문단」 증원용 예비 슬롯 — InstancedMesh 개수는 마운트 시 고정이라,
      // 미리 죽은 슬롯을 만들어 두지 않으면 층이 붐빌 때 증원이 통째로 안 붙는다
      // (실측: 12층에서 73마리가 전부 살아 있어 빈 슬롯이 0이었다).
      if (!isBossFloor && floorNo >= 8) {
        const [ex3, ez3] = cellToWorld(floor.exit.x, floor.exit.y);
        for (let k = 0; k < 12; k++) {
          list.push({
            x: ex3, z: ez3, hp: 0, alive: false, hitCd: 0, wobble: Math.random() * 6,
            flash: 0, type: 'chaser', ai: 0, mode: 0, adx: 0, adz: 0, elite: false,
          });
        }
      }
      // 갈림길 「모험의 길」 — 계약된 층은 스폰이 1.5배로 몰려온다
      if (danger) {
        floor.spawns
          .filter((_, i) => i % 2 === 0)
          .forEach((s) => {
            const [wx, wz] = cellToWorld(s.x, s.y);
            const type = pickEnemyType(floorNo);
            list.push({
              x: wx + 0.8,
              z: wz + 0.8,
              hp: type === 'tank' ? baseHp * 2.8 : type === 'shooter' ? baseHp * 0.8 : baseHp,
              alive: true,
              hitCd: 0,
              wobble: Math.random() * 6,
              flash: 0,
              type,
              ai: Math.random() * 1.5,
              mode: 0,
              adx: 0,
              adz: 0,
              elite: false,
            });
          });
      }
      // 출구 수문장 — 보스 없는 층(4층부터)의 문 앞을 정예가 지킨다.
      // 조준 후 강하게 돌진해 HP를 크게 깎아, 깊이 내려갈수록 긴장감을 유지한다.
      if (!isBossFloor && floorNo >= 4) {
        const gx0 = floor.exit.x;
        const gy0 = floor.exit.y;
        const dirx = Math.sign(floor.start.x - gx0) || 1;
        const diry = Math.sign(floor.start.y - gy0) || 0;
        let gcx = gx0;
        let gcy = gy0;
        // 문에 가장 가까운 valid 셀을 우선 (문 바로 앞을 지키게)
        for (let step = 1; step <= 3; step++) {
          const cx = gx0 + dirx * step;
          const cy = gy0 + diry * step;
          if (isFloor(floor.cells, cx, cy)) {
            gcx = cx;
            gcy = cy;
            break;
          }
        }
        const [gwx, gwz] = cellToWorld(gcx, gcy);
        list.push({
          x: gwx,
          z: gwz,
          hp: (35 + floorNo * 11) * (1 + Math.pow(Math.max(0, floorNo - 25) / 25, 2) * 2.5),
          alive: true,
          hitCd: 0.6,
          wobble: Math.random() * 6,
          flash: 0,
          type: 'dasher',
          ai: 0.8,
          mode: 0,
          adx: 0,
          adz: 0,
          elite: true,
        });
      }
      return list;
    })(),
  );
  const shots = useRef<Shot[]>(
    Array.from({ length: MAX_SHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, pierce: 0, bounce: 0, last: -1, charge: 0, alive: false })),
  );
  const fanCounter = useRef(0); // 진화 「쏟아지는 문장」 — N번째 공격 카운터
  const evoFxSeen = useRef(evoFxRef?.current ?? 0); // 진화 획득 연출 트리거 감지
  const evoRingRef = useRef<THREE.Mesh>(null); // 진화 보유 상시 표시 — 발밑 금빛 룬 링
  const particles = useRef<Particle[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0, max: 1, size: 0.1, alive: false,
      color: new THREE.Color(),
    })),
  );
  const fireTimer = useRef(0);
  const exited = useRef(false);
  const homeState = useRef<'idle' | 'pending' | 'used'>('idle');
  const homeRetrySeen = useRef(homeRetryRef.current);
  const homeWaitLeave = useRef(false);
  const homeUsedSeen = useRef(homeUsedRef.current);
  const homeDoorRef = useRef<THREE.Group>(null);
  // 히트스톱 남은 시간(초) — 명중한 프레임에 dt를 0으로 만들어 '무게'를 만든다.
  const hitStop = useRef(0);
  // ── 임팩트 파문 (2026-07-27) — **카메라 셰이크의 대체품**.
  // 예전엔 타격마다 카메라를 밀고 흔들었다. 한 방 한 방엔 잘 맞는 장치지만 이 게임은
  // 자동 발사라 명중이 끊이지 않아 결과가 '상시 진동'이 됐고, 그건 타격감이 아니라 멀미다.
  // 그래서 무게를 **시점 이동이 아니라 세계의 반응**으로 옮긴다 — 카메라는 가만히 있고
  // 맞은 자리에서 충격 링이 퍼진다. 시선이 흔들리지 않으니 오래 봐도 눈이 편하고,
  // 임팩트가 '어디서' 났는지도 오히려 더 잘 읽힌다(셰이크는 화면 전체라 위치 정보가 없었다).
  const MAX_RIPPLES = 14;
  const rippleMeshRef = useRef<THREE.InstancedMesh>(null);
  const ripples = useRef(
    Array.from({ length: MAX_RIPPLES }, () => ({
      x: 0, z: 0, ttl: 0, max: 1, r0: 0.4, r1: 1.6, alive: false,
      color: new THREE.Color(),
    })),
  );
  const rippleTmp = useMemo(() => new THREE.Color(), []);
  const ripple = (x: number, z: number, power: number, color = '#ffd8a8') => {
    // 빈 슬롯이 없으면 가장 사그라든 것을 재활용한다 — 연출은 밀리면 안 된다
    let slot = ripples.current.find((r) => !r.alive);
    if (!slot) slot = ripples.current.reduce((a, b) => (a.ttl <= b.ttl ? a : b));
    const pw = Math.min(1.4, Math.max(0.15, power));
    slot.x = x;
    slot.z = z;
    slot.max = 0.24 + pw * 0.28;
    slot.ttl = slot.max;
    slot.r0 = 0.3 + pw * 0.4;
    slot.r1 = slot.r0 + 1.0 + pw * 2.4;
    slot.color.set(color);
    slot.alive = true;
  };
  // ── 「마지막 문단」 (2026-07-25) — 출구 앞에서 층이 한 번 저항한다.
  // 설계 의도: 난이도를 전역으로 올리면 '억울한 죽음'만 늘고 봉우리는 안 생긴다.
  // 대신 **한 층에 딱 한 번, 예고된 자리(출구)** 에서 압력을 몰아준다 —
  // 긴장 → 돌파 → 해소의 리듬을 만들고, 차지 샷이 그 돌파 수단이 된다.
  const surge = useRef<{ state: 'idle' | 'active' | 'done'; t: number }>({ state: 'idle', t: 0 });
  const SURGE_SECONDS = 5;
  // 타격 신호 한 곳 — 세기(0~1)와 **터진 자리**를 받아 히트스톱과 파문을 동시에 건다.
  // (예전 인자는 셰이크 방향 벡터였다 — 화면을 안 미니 이제 필요한 건 좌표다)
  const impact = (power: number, x: number, z: number, color?: string) => {
    hitStop.current = Math.max(hitStop.current, Math.min(0.09, 0.02 + power * 0.07));
    ripple(x, z, power, color);
  };
  const glowTimer = useRef(0);
  const sparkleTimer = useRef(0.4);
  const chestState = useRef<'idle' | 'pending' | 'opened' | 'failed'>('idle');
  const seenQuizSeq = useRef(quizResultRef.current?.seq ?? 0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 5층 단위 몬스터 티어 (모양·색 변화)
  const enemyTier = Math.floor((floorNo - 1) / 5) % ENEMY_TIER_COLORS.length;

  // 자주 쓰는 색은 미리 만들어 재사용 (프레임 중 할당 방지)

  const enemyGeoms = useMemo(() => {
    const kinds: EnemyKind[] = ['chaser', 'shooter', 'dasher', 'tank', 'elite'];
    return Object.fromEntries(kinds.map((k) => [k, buildEnemyGeometry(k, enemyTier)])) as Record<
      EnemyKind,
      THREE.BufferGeometry
    >;
  }, [enemyTier]);
  useEffect(() => {
    const gs = enemyGeoms;
    return () => Object.values(gs).forEach((g) => g.dispose());
  }, [enemyGeoms]);

  const palette = useMemo(
    () => ({
      enemyBase: new THREE.Color(ENEMY_TIER_COLORS[enemyTier]),
      white: new THREE.Color('#ffffff'),
      tmp: new THREE.Color(),
      elite: new THREE.Color('#ff2e1f'), // 수문장 정예 색 (강렬한 진홍)
      shotTiers: [new THREE.Color('#ffd166'), new THREE.Color('#ff9a3d'), new THREE.Color('#ff5136')],
    }),
    [enemyTier],
  );

  const [startX, startZ] = useMemo(() => cellToWorld(floor.start.x, floor.start.y), [floor]);
  const [exitX, exitZ] = useMemo(() => cellToWorld(floor.exit.x, floor.exit.y), [floor]);
  // 🔥 모험의 길 — 출구 곁의 붉은 포털. 화면으로 묻지 않고 **어느 포털에 몸을 넣는지**로 고른다.
  // 자리가 없는 층(출구가 구석에 몰린 경우)이면 그냥 안 열린다 — 갈림길은 보너스지 필수가 아니다.
  const forkCell = useMemo(() => (fork ? forkSpot(floor) : null), [fork, floor]);
  const forkPos = useMemo<[number, number] | null>(
    () => (forkCell ? cellToWorld(forkCell.x, forkCell.y) : null),
    [forkCell],
  );
  const forkRef = useRef<THREE.Group>(null);

  // 보스 (10층마다) — 출구를 지키고 있으며, 쓰러뜨려야 포털이 열린다
  const bossVariant = isBossFloor ? bossVariantOf(floorNo) : 'radial';
  const boss = useRef<Boss | null>(
    isBossFloor
      ? {
          x: exitX,
          z: exitZ,
          hp: 500 + floorNo * 50,
          maxHp: 500 + floorNo * 50,
          alive: true,
          hitCd: 0,
          fireTimer: 1.5,
          flash: 0,
          mode: 0,
          ai: 0,
          adx: 0,
          adz: 0,
          volley: 0,
        }
      : null,
  );
  const bossDead = useRef(!isBossFloor);
  const bossMeshRef = useRef<THREE.Mesh>(null);
  const bossMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const eshots = useRef<EShot[]>(
    Array.from({ length: MAX_ESHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, alive: false })),
  );
  const eshotMeshRef = useRef<THREE.InstancedMesh>(null);
  const eliteLightRef = useRef<THREE.PointLight>(null); // 출구 수문장 발치의 붉은 광원

  // 보스 체력바 초기 보고
  useEffect(() => {
    if (boss.current) onBossHp(boss.current.hp, boss.current.maxHp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const killBoss = () => {
    const b = boss.current;
    if (!b || !b.alive) return;
    b.alive = false;
    bossDead.current = true;
    burst(b.x, 1.2, b.z, '#c06bff', 24, 2.6);
    burst(b.x, 1.6, b.z, '#ffffff', 12, 1.8);
    ripple(b.x, b.z, 1.3, '#c06bff');
    for (const sh of eshots.current) sh.alive = false;
    onBossHp(0, b.maxHp);
    onBossDown();
  };
  const chestPos = useMemo(
    () => (floor.chest ? cellToWorld(floor.chest.x, floor.chest.y) : null),
    [floor],
  );
  const homePos = useMemo(
    () => (floor.homeDoor ? cellToWorld(floor.homeDoor.x, floor.homeDoor.y) : null),
    [floor],
  );
  const tracePos = useMemo(
    () => (floor.trace ? cellToWorld(floor.trace.x, floor.trace.y) : null),
    [floor],
  );
  const girlPos = useMemo(
    () => (floor.girl ? cellToWorld(floor.girl.x, floor.girl.y) : null),
    [floor],
  );
  const traceSeen = useRef(false);
  const girlMet = useRef(false);
  const traceRef = useRef<THREE.Group>(null);
  const girlRef = useRef<THREE.Group>(null);

  // ── 방 이벤트: 제단·찢어진 페이지·몬스터 하우스 코인 무더기
  const altarPos = useMemo(
    () => (floor.altar ? cellToWorld(floor.altar.x, floor.altar.y) : null),
    [floor],
  );
  const secretPos = useMemo(
    () => (floor.secret ? cellToWorld(floor.secret.x, floor.secret.y) : null),
    [floor],
  );
  const orbPos = useMemo(() => floor.houseOrbs.map((o) => cellToWorld(o.x, o.y)), [floor]);
  const altarState = useRef<'idle' | 'pending' | 'used'>('idle');
  const altarRetrySeen = useRef(altarRetryRef.current);
  const altarWaitLeave = useRef(false);
  const altarUsedSeen = useRef(altarUsedRef.current);
  const altarRef = useRef<THREE.Group>(null);
  const secretState = useRef<'idle' | 'pending'>('idle');
  const secretRetrySeen = useRef(secretRetryRef.current);
  const secretWaitLeave = useRef(false);
  const secretRef = useRef<THREE.Group>(null);
  const orbTaken = useRef<boolean[]>(floor.houseOrbs.map(() => false));
  const orbRefs = useRef<(THREE.Group | null)[]>([]);

  // ── 두 갈래 틈 (층 안 순간이동 지름길 한 쌍 — 왕복 무제한)
  const riftPos = useMemo(
    () => (floor.rifts ? floor.rifts.map((r) => cellToWorld(r.x, r.y)) : null),
    [floor],
  );
  const riftState = useRef<'idle' | 'pending'>('idle');
  const riftFromIdx = useRef(0); // 어느 쪽 틈에 닿았나 (0/1)
  const riftRetrySeen = useRef(riftRetryRef.current);
  const riftGoSeen = useRef(riftGoRef.current);
  const riftWaitLeave = useRef(false);
  const riftRefs = useRef<(THREE.Group | null)[]>([null, null]);

  // ── 무너지는 서가 (흔들면 보물 + 역류 카운트다운 시작 — 시간↔보물 트레이드)
  const collapsePos = useMemo(
    () => (floor.collapse ? cellToWorld(floor.collapse.x, floor.collapse.y) : null),
    [floor],
  );
  const collapseState = useRef<'idle' | 'pending' | 'used'>('idle');
  const collapseRetrySeen = useRef(collapseRetryRef.current);
  const collapseWaitLeave = useRef(false);
  const collapseUsedSeen = useRef(collapseUsedRef.current);
  const collapseRef = useRef<THREE.Group>(null);

  // ── 좀먹은 바닥 (2026-07-27) — 눈에 보이는 함정 타일 패치. 한 칸당 1회만 발동(밟으면 소진).
  const mirePos = useMemo(() => (floor.mire ? floor.mire.map((m) => cellToWorld(m.x, m.y)) : null), [floor]);
  const mireHit = useRef<boolean[]>(floor.mire ? floor.mire.map(() => false) : []);

  // 나침반 화살표 (플레이어 주위를 돌며 목표 방향 표시)
  const portalArrowRef = useRef<THREE.Group>(null);
  const chestArrowRef = useRef<THREE.Group>(null);
  const homeArrowRef = useRef<THREE.Group>(null);
  const girlArrowRef = useRef<THREE.Group>(null);

  // 데미지 숫자 (캔버스 스프라이트 풀)
  const DMG_POOL = 14;
  const dmgNums = useRef(
    Array.from({ length: DMG_POOL }, () => ({ x: 0, y: 0, z: 0, ttl: 0, max: 0.7, alive: false })),
  );
  const dmgCanvases = useMemo(
    () =>
      Array.from({ length: DMG_POOL }, () => {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 64;
        return c;
      }),
    [],
  );
  const dmgTextures = useMemo(
    () => dmgCanvases.map((c) => new THREE.CanvasTexture(c)),
    [dmgCanvases],
  );
  const dmgSprites = useRef<(THREE.Sprite | null)[]>(Array.from({ length: DMG_POOL }, () => null));
  const spawnDmg = (x: number, z: number, val: number | string, color = '#ffe08a') => {
    const i = dmgNums.current.findIndex((d) => !d.alive);
    if (i < 0) return;
    const d = dmgNums.current[i];
    d.x = x + (Math.random() - 0.5) * 0.4;
    d.z = z;
    d.y = 1.15;
    d.ttl = d.max;
    d.alive = true;
    const ctx = dmgCanvases[i].getContext('2d')!;
    ctx.clearRect(0, 0, 128, 64);
    ctx.font = "44px 'Jua', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(20,10,30,0.85)';
    ctx.strokeText(String(val), 64, 34);
    ctx.fillStyle = color;
    ctx.fillText(String(val), 64, 34);
    dmgTextures[i].needsUpdate = true;
  };

  // 파티클 분출 — 타격 스파크, 처치 폭발, 보물 개봉 등
  const burst = (x: number, y: number, z: number, color: string, n: number, speed: number) => {
    const c = new THREE.Color(color);
    let spawned = 0;
    for (const pt of particles.current) {
      if (pt.alive) continue;
      const ang = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random() * 0.6) * speed;
      pt.x = x;
      pt.y = y;
      pt.z = z;
      pt.vx = Math.sin(ang) * r;
      pt.vz = Math.cos(ang) * r;
      pt.vy = 2 + Math.random() * 2.5;
      pt.max = 0.45 + Math.random() * 0.3;
      pt.ttl = pt.max;
      pt.size = 0.09 + Math.random() * 0.12;
      pt.color.copy(c);
      pt.alive = true;
      if (++spawned >= n) break;
    }
  };

  // 바닥·벽 셀 목록 (벽은 바닥과 인접한 것만 세워 인스턴스 수 절약)
  const { floorCells, wallCells } = useMemo(() => {
    const f: [number, number][] = [];
    const w: [number, number][] = [];
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    ] as const;
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        if (isFloor(floor.cells, x, y)) f.push([x, y]);
        else if (dirs.some(([dx, dy]) => isFloor(floor.cells, x + dx, y + dy))) w.push([x, y]);
      }
    return { floorCells: f, wallCells: w };
  }, [floor]);

  // ── 잉크 리빌 — 층 지형이 입구에서부터 '쓰여진다' (세계관: 작가가 이 장을 쓰는 중).
  // 시각 전용: 충돌(canStand)·적 AI·미니맵·봇 판단은 셀 그리드 기반이라 전혀 안 변한다.
  // 배치 effect가 위치·거리 배열을 채우며 ε 크기로 시작하고, useFrame이 조작 가능해진
  // 첫 프레임부터(글귀 오버레이가 닫힌 순간) 입구→먼 곳 순서로 자라나게 다시 쓴다.
  const revealRef = useRef<{
    t: number;
    done: boolean;
    f: Float32Array; // 바닥: [wx, wz, dist01] × N
    w: Float32Array; // 벽: [wx, wz, sy, dist01] × N
  } | null>(null);
  const REVEAL_STAG = 0.62; // 입구→가장 먼 타일까지의 시차 (초)
  const REVEAL_RISE = 0.3; // 타일 하나가 자라는 시간 (초)
  const writeReveal = (elapsed: number): boolean => {
    const rv = revealRef.current;
    const fm = floorMeshRef.current;
    const wm = wallMeshRef.current;
    if (!rv || !fm || !wm) return true;
    const ease = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
    let allDone = true;
    for (let i = 0; i < floorCells.length; i++) {
      const s = ease((elapsed - rv.f[i * 3 + 2] * REVEAL_STAG) / REVEAL_RISE);
      if (s < 1) allDone = false;
      const sc = Math.max(s, 0.001);
      // 바닥(두께 0.3, 최종 중심 -0.15) — 바닥면(-0.3)에 붙은 채 자란다
      dummy.position.set(rv.f[i * 3], -0.3 + 0.15 * sc, rv.f[i * 3 + 1]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      fm.setMatrixAt(i, dummy.matrix);
    }
    for (let i = 0; i < wallCells.length; i++) {
      const s = ease((elapsed - rv.w[i * 4 + 3] * REVEAL_STAG) / REVEAL_RISE);
      if (s < 1) allDone = false;
      const sc = Math.max(s, 0.001);
      const sy0 = rv.w[i * 4 + 2];
      // 벽 밑면을 고정한 채 위로 자라 s=1에서 원래 배치(중심 1.3, 높이 배율 sy0)와 일치
      dummy.position.set(rv.w[i * 4], 1.3 - 1.3 * sy0 * (1 - sc), rv.w[i * 4 + 1]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(sc, sy0 * sc, sc);
      dummy.updateMatrix();
      wm.setMatrixAt(i, dummy.matrix);
    }
    fm.instanceMatrix.needsUpdate = true;
    wm.instanceMatrix.needsUpdate = true;
    return allDone;
  };

  // 정적 지형 인스턴스 배치 (마운트 시 1회) — 색은 10층 단위 테마.
  // 가짜 AO: 벽에 인접한 바닥 타일을 어둡게 구워(인스턴스 색) 공간에 명암 깊이를 만든다.
  // 여기에 셀 해시 미세 변주를 곱해 단색 평면 느낌을 깬다 (렌더 비용 0).
  const theme = dungeonTheme(floorNo);
  useLayoutEffect(() => {
    const dirs8 = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    ] as const;
    const fArr = new Float32Array(floorCells.length * 3);
    const wArr = new Float32Array(wallCells.length * 4);
    let maxD = 1;
    const fm = floorMeshRef.current;
    if (fm) {
      const c1 = new THREE.Color(theme.f1);
      const c2 = new THREE.Color(theme.f2);
      const houseTint = new THREE.Color('#7a2030'); // 몬스터 하우스 방은 불길한 붉은 기
      const mireTint = new THREE.Color('#3a2f1a'); // 좀먹은 바닥 — 삭아서 거뭇하게 죽은 색
      const tmp = new THREE.Color();
      const house = floor.house;
      const mireSet = floor.mire ? new Set(floor.mire.map((m) => `${m.x},${m.y}`)) : null;
      floorCells.forEach(([x, y], i) => {
        const [wx, wz] = cellToWorld(x, y);
        fArr[i * 3] = wx;
        fArr[i * 3 + 1] = wz;
        fArr[i * 3 + 2] = Math.hypot(wx - startX, wz - startZ);
        maxD = Math.max(maxD, fArr[i * 3 + 2]);
        tmp.copy((x + y) % 2 === 0 ? c1 : c2);
        if (house && x >= house.x && x < house.x + house.w && y >= house.y && y < house.y + house.h) {
          tmp.lerp(houseTint, 0.24);
        }
        if (mireSet && mireSet.has(`${x},${y}`)) tmp.lerp(mireTint, 0.5);
        // 가짜 AO (벽 인접 수 비례) + 결정적 미세 변주
        let wallN = 0;
        for (const [dx, dy] of dirs8) if (!isFloor(floor.cells, x + dx, y + dy)) wallN++;
        const ao = 1 - Math.min(0.32, wallN * 0.085);
        tmp.multiplyScalar(ao * (0.94 + cellHash(x, y, floorNo) * 0.12));
        fm.setColorAt(i, tmp);
      });
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }
    const wm = wallMeshRef.current;
    if (wm) {
      const wtmp = new THREE.Color();
      wallCells.forEach(([x, y], i) => {
        const [wx, wz] = cellToWorld(x, y);
        const h = cellHash(x, y, floorNo);
        wArr[i * 4] = wx;
        wArr[i * 4 + 1] = wz;
        wArr[i * 4 + 2] = 0.96 + h * 0.09; // 벽 높이도 살짝 들쭉날쭉 (유기적 실루엣)
        wArr[i * 4 + 3] = Math.hypot(wx - startX, wz - startZ);
        maxD = Math.max(maxD, wArr[i * 4 + 3]);
        wtmp.setScalar(0.9 + h * 0.2); // 재질 색에 곱해지는 밝기 변주
        wm.setColorAt(i, wtmp);
      });
      if (wm.instanceColor) wm.instanceColor.needsUpdate = true;
    }
    // 거리 정규화(0~1) 후 ε 크기로 초기 배치 — 리빌은 useFrame이 진행
    for (let i = 0; i < floorCells.length; i++) fArr[i * 3 + 2] /= maxD;
    for (let i = 0; i < wallCells.length; i++) wArr[i * 4 + 3] /= maxD;
    revealRef.current = { t: 0, done: false, f: fArr, w: wArr };
    writeReveal(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorCells, wallCells, dummy, theme, floor, floorNo, startX, startZ]);

  // 개발 검증용 훅 (프로덕션 빌드에서는 제외)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__d100 = {
      teleport: (x: number, z: number) => {
        const p = playerRef.current;
        if (p) {
          p.position.x = x;
          p.position.z = z;
        }
      },
      // 밸런스 봇용 지형 스냅샷 — 층당 1회 호출해 BFS 길찾기에 사용 (DEV 전용)
      grid: () => ({
        cells: Array.from(floor.cells),
        grid: GRID,
        cell: CELL,
      }),
      state: () => ({
        floorNo,
        player: playerRef.current
          ? [playerRef.current.position.x, playerRef.current.position.z]
          : null,
        chestWorld: chestPos,
        chestState: chestState.current,
        exit: [exitX, exitZ],
        exited: exited.current,
        forkWorld: forkPos, // 🔥 모험의 길 붉은 포털 (null = 이 층엔 없음)
        homeWorld: homePos,
        homeState: homeState.current,
        traceWorld: tracePos,
        traceSeen: traceSeen.current,
        girlWorld: girlPos,
        altarWorld: altarPos,
        altarState: altarState.current,
        surge: { state: surge.current.state, t: +surge.current.t.toFixed(2) },
        musicIntensity: +music.getIntensity().toFixed(3), // 적응형 강도 레이어 검증용
        kindCounts: Object.fromEntries(
          (Object.keys(enemyKindRefs.current) as EnemyKind[]).map((k) => [
            k,
            enemyKindRefs.current[k]?.count ?? 0,
          ]),
        ),
        charge: charge.current, // 차지 샷 축적 (0~1) — 자동 검증용
        freeze: { n: freezeUiRef.current.n, ready: freezeUiRef.current.ready, active: +freezeActiveRef.current.toFixed(2) },
        resolve: { n: resolveUiRef.current.n, ready: resolveUiRef.current.ready, active: +resolveActiveRef.current.toFixed(2) },
        shotsAlive: shots.current.filter((sh) => sh.alive).length,
        chargedShots: shots.current.filter((sh) => sh.alive && sh.charge > 0).length,
        collapseWorld: collapsePos,
        collapseState: collapseState.current,
        secretWorld: secretPos,
        secretState: secretState.current,
        riftWorlds: riftPos,
        riftState: riftState.current,
        orbsLeft: orbTaken.current.filter((v) => !v).length,
        orbWorlds: orbPos.filter((_, i) => !orbTaken.current[i]),
        enemyTier,
        boss: boss.current
          ? { hp: boss.current.hp, alive: boss.current.alive, variant: bossVariant, mode: boss.current.mode }
          : null,
        // 밸런스 봇용 좌표 노출 — 보스·탄막·적 위치를 읽어 회피 기동을 계산한다 (DEV 전용)
        bossWorld:
          boss.current && boss.current.alive ? [boss.current.x, boss.current.z] : null,
        eshots: eshots.current.filter((s) => s.alive).map((s) => [s.x, s.z, s.dx, s.dz]),
        enemiesPos: enemies.current.filter((e) => e.alive).map((e) => [e.x, e.z]),
        guardian: (() => {
          const g = enemies.current.find((e) => e.elite);
          return g ? { hp: Math.round(g.hp), alive: g.alive, mode: g.mode, pos: [g.x, g.z] } : null;
        })(),
        enemiesAlive: enemies.current.filter((e) => e.alive).length,
        enemyTypes: enemies.current.reduce(
          (acc, e) => {
            acc[e.type] = (acc[e.type] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
      }),
      hitBoss: (n: number) => {
        const b = boss.current;
        if (b && b.alive) {
          b.hp -= n;
          onBossHp(Math.max(0, b.hp), b.maxHp);
          if (b.hp <= 0) killBoss();
        }
      },
      killEnemies: () => enemies.current.forEach((e) => (e.alive = false)),
      // 임팩트 파문을 발밑에 하나 터뜨린다 — 셰이크를 대체한 연출을 실제 픽셀로 확인하려고
      // (전투를 붙이지 않고도 `__d100shot()`으로 링이 그려지는지 볼 수 있다)
      ripple: (power = 0.8, color?: string) => {
        const pp = playerRef.current;
        if (pp) ripple(pp.position.x, pp.position.z, power, color);
      },
    };
  }, [chestPos, homePos, enemyTier, exitX, exitZ]);

  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // ── 미니맵 채널 초기화 (층 마운트 시 1회) — 탐사 마스크는 층마다 새로
  const minimapTick = useRef(0);
  useEffect(() => {
    const ch = minimapRef?.current;
    if (!ch) return;
    ch.cells = floor.cells;
    ch.seen = new Uint8Array(GRID * GRID);
    ch.exitX = floor.exit.x;
    ch.exitY = floor.exit.y;
    ch.chestX = floor.chest ? floor.chest.x : -1;
    ch.chestY = floor.chest ? floor.chest.y : -1;
    ch.homeX = floor.homeDoor ? floor.homeDoor.x : -1;
    ch.homeY = floor.homeDoor ? floor.homeDoor.y : -1;
    ch.forkX = forkCell ? forkCell.x : -1;
    ch.forkY = forkCell ? forkCell.y : -1;
    ch.bossAlive = isBossFloor;
    ch.floorColor = theme.f1;
    ch.version++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, forkCell]);

  useFrame((state, delta) => {
    const devWin = window as unknown as Record<string, unknown>;
    const fixdt = import.meta.env.DEV ? Number(devWin.__d100fixdt) || 0 : 0;
    const speedScale = (import.meta.env.DEV && Number(devWin.__d100speed)) || 1;
    let dt = fixdt > 0 ? fixdt : Math.min(delta, 0.05) * speedScale;
    // ── 히트스톱 (2026-07-25) — 명중한 프레임에 시뮬레이션을 수십 ms 얼린다.
    // "무게"를 만드는 가장 값싼 장치: 접촉과 반응 사이의 공백을 뇌가 '묵직함'으로 읽는다.
    // dt를 0으로 만들 뿐이라 이동·AI·투사체가 통째로 멈췄다 이어진다(상태 보존).
    // ⚠️ 봇 검증(고정 dt) 중에는 끈다 — 밸런스 측정에 프레임 정지가 섞이면 안 된다.
    if (fixdt <= 0 && hitStop.current > 0) {
      hitStop.current = Math.max(0, hitStop.current - Math.min(delta, 0.05));
      dt = 0;
    }
    const t = state.clock.elapsedTime;
    const stats = statsRef.current;
    const p = playerRef.current;
    if (!p) return;

    // 잉크 리빌 진행 — 조작이 가능해진 순간부터 (글귀 오버레이·마을·미니게임 중엔 대기)
    const rv = revealRef.current;
    if (rv && !rv.done && !hiddenRef.current && !pausedRef.current) {
      rv.t += dt;
      if (writeReveal(rv.t)) rv.done = true;
    }

    // 플레이어 피격 공통 — 잔상 회피(MISS)·단단한 표지(피해 감소) 반영. 적용된 피해 반환(회피 = 0).
    const hurtPlayer = (dmg: number): number => {
      // 결의 무적 대시 — 모든 접촉 피해 판정이 이 함수 하나를 반드시 거치므로(적·수문장·탄막·
      // 좀먹은 바닥 전부) 가드도 여기 한 곳에만 둔다. 찰나의 `!frozenNow`처럼 호출부마다
      // 따로 걸면 새 피해 판정이 생길 때마다 빠뜨릴 위험이 있다 — 실제로 이 함수의 호출부가
      // 이미 4곳이라 손으로 세면 놓치기 쉬웠다.
      if (resolveActiveRef.current > 0) {
        spawnDmg(p.position.x, p.position.z, 'DASH', '#ffd166');
        return 0;
      }
      if (stats.dodge > 0 && Math.random() < stats.dodge) {
        spawnDmg(p.position.x, p.position.z, 'MISS', '#9fe8ff');
        return 0;
      }
      const applied = Math.max(1, Math.round(dmg * (1 - stats.armor)));
      onDamage(applied);
      // 진화 「단단한 장정」 — 맞는 순간 충격파: 주변을 밀쳐내고 벤다
      if (stats.shockwave > 0) {
        burst(p.position.x, 0.6, p.position.z, '#ffd166', 16, 2.8);
        ripple(p.position.x, p.position.z, 0.9, '#ffd166');
        for (const e2 of enemies.current) {
          if (!e2.alive) continue;
          const dd = Math.hypot(e2.x - p.position.x, e2.z - p.position.z);
          if (dd < 3.2) {
            e2.hp -= 10 + stats.thorns;
            e2.flash = 1;
            if (!e2.elite && e2.type !== 'tank') {
              const ux2 = (e2.x - p.position.x) / (dd || 1);
              const uz2 = (e2.z - p.position.z) / (dd || 1);
              const kx = e2.x + ux2 * 2.2;
              const kz = e2.z + uz2 * 2.2;
              if (canStand(floor.cells, kx, e2.z, 0.38)) e2.x = kx;
              if (canStand(floor.cells, e2.x, kz, 0.38)) e2.z = kz;
            }
            if (e2.hp <= 0) killEnemy(e2, true);
          }
        }
      }
      return applied;
    };

    // 처치 공통 — 코인·흡혈·폭발 구슬(연쇄는 1단계만) 처리
    const killEnemy = (e: Enemy, chain: boolean) => {
      e.alive = false;
      burst(e.x, 0.8, e.z, e.elite ? '#ff3020' : '#ff5d7e', e.elite ? 22 : 12, e.elite ? 2.6 : 2.0);
      if (e.elite) burst(e.x, 1.3, e.z, '#ffffff', 10, 1.8);
      // 처치는 '마지막 일격'이라 타격보다 길게 얼린다 — 정예는 더 길게.
      // 파문은 쓰러진 자리에서 퍼진다 (누가 죽었는지가 화면에 남는다)
      impact(e.elite ? 0.9 : 0.4, e.x, e.z, e.elite ? '#ff7a3d' : '#ffb020');
      onKill(e.elite ? 12 : e.type === 'tank' ? 3 : 1, e.elite ? 'elite' : e.type); // 코인 + 도감 기록
      if (stats.lifesteal > 0) onHeal(stats.lifesteal);
      // 찰나 게이지 — 처치마다 1씩(연쇄 폭발도 포함), 가득 차면 버튼이 발동 가능 상태로 바뀐다
      const fz = freezeUiRef.current;
      if (!fz.ready && fz.n < FREEZE_KILLS) {
        fz.n++;
        if (fz.n >= FREEZE_KILLS) {
          fz.ready = true;
          sfx.freezeReady();
        }
      }
      // 결의 게이지 — 같은 처치 이벤트가 독립적으로 채운다(찰나와 동시에 차올라도 서로 무관)
      const rs = resolveUiRef.current;
      if (!rs.ready && rs.n < RESOLVE_KILLS) {
        rs.n++;
        if (rs.n >= RESOLVE_KILLS) {
          rs.ready = true;
          sfx.resolveReady();
        }
      }
      if (chain && stats.boom > 0) {
        burst(e.x, 0.9, e.z, '#ff9a3d', 14, 2.2);
        for (const e2 of enemies.current) {
          if (!e2.alive || e2 === e) continue;
          if (Math.hypot(e2.x - e.x, e2.z - e.z) < 2.4) {
            e2.hp -= stats.boom;
            e2.flash = 1;
            spawnDmg(e2.x, e2.z, Math.round(stats.boom), '#ff9a3d');
            if (e2.hp <= 0) killEnemy(e2, false);
          }
        }
      }
    };

    if (portalRef.current) {
      portalRef.current.rotation.y = t * 1.4;
      portalRef.current.position.y = 1.1 + Math.sin(t * 2) * 0.12;
    }

    // ── 수수께끼 결과 반영 (보물 개봉/실패 연출)
    const qr = quizResultRef.current;
    if (qr && qr.seq !== seenQuizSeq.current) {
      seenQuizSeq.current = qr.seq;
      if (chestState.current === 'pending' && chestPos) {
        chestState.current = qr.ok ? 'opened' : 'failed';
        if (qr.ok) {
          burst(chestPos[0], 0.8, chestPos[1], '#ffd166', 26, 2.2);
          burst(chestPos[0], 0.8, chestPos[1], '#fff3c4', 10, 1.2);
          ripple(chestPos[0], chestPos[1], 0.9, '#ffd166');
          glowTimer.current = 1.6;
        } else {
          burst(chestPos[0], 0.7, chestPos[1], '#8d86a8', 10, 1.1);
        }
        // 퀴즈 직후 바로 얻어맞지 않게 잠깐의 자비
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9);
      }
    }

    // ── 마을 문: "나중에" → 벗어나면 재무장 / 방문 완료 → 문 소멸 + 자비
    if (homeRetryRef.current !== homeRetrySeen.current) {
      homeRetrySeen.current = homeRetryRef.current;
      homeWaitLeave.current = true;
    }
    if (homeWaitLeave.current && homePos) {
      if (Math.hypot(p.position.x - homePos[0], p.position.z - homePos[1]) > 2.6) {
        homeWaitLeave.current = false;
        homeState.current = 'idle';
      }
    }
    if (homeUsedRef.current !== homeUsedSeen.current) {
      homeUsedSeen.current = homeUsedRef.current;
      if (homeState.current === 'pending') {
        homeState.current = 'used';
        if (homePos) burst(homePos[0], 1.2, homePos[1], '#ffcf8a', 14, 1.6);
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9);
      }
    }

    // ── 제단: "그만둔다" → 벗어나면 재무장 / 바침 → 소멸 + 자비
    if (altarRetryRef.current !== altarRetrySeen.current) {
      altarRetrySeen.current = altarRetryRef.current;
      altarWaitLeave.current = true;
    }
    if (altarWaitLeave.current && altarPos) {
      if (Math.hypot(p.position.x - altarPos[0], p.position.z - altarPos[1]) > 2.4) {
        altarWaitLeave.current = false;
        altarState.current = 'idle';
      }
    }
    if (altarUsedRef.current !== altarUsedSeen.current) {
      altarUsedSeen.current = altarUsedRef.current;
      if (altarState.current === 'pending') {
        altarState.current = 'used';
        if (altarPos) burst(altarPos[0], 0.9, altarPos[1], '#ff5d7e', 16, 1.8);
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9);
      }
    }

    // ── 무너지는 서가: "그만둔다" → 벗어나면 재무장 / 흔듦 → 서가가 무너지고 역류 시작
    if (collapseRetryRef.current !== collapseRetrySeen.current) {
      collapseRetrySeen.current = collapseRetryRef.current;
      collapseWaitLeave.current = true;
    }
    if (collapseWaitLeave.current && collapsePos) {
      if (Math.hypot(p.position.x - collapsePos[0], p.position.z - collapsePos[1]) > 2.4) {
        collapseWaitLeave.current = false;
        collapseState.current = 'idle';
      }
    }
    if (collapseUsedRef.current !== collapseUsedSeen.current) {
      collapseUsedSeen.current = collapseUsedRef.current;
      if (collapseState.current === 'pending') {
        collapseState.current = 'used';
        if (collapsePos) {
          // 책이 쏟아지고 먼지가 인다 — 무너짐의 시작
          burst(collapsePos[0], 1.4, collapsePos[1], '#ffd166', 20, 2.2);
          burst(collapsePos[0], 0.8, collapsePos[1], '#8d86a8', 18, 1.6);
        }
        if (collapsePos) ripple(collapsePos[0], collapsePos[1], 1.4, '#e0d4b0');
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9);
      }
    }
    // 역류 중 — 층 곳곳에서 먼지가 떨어진다 (시각 전용, 충돌·AI 불변)
    if (rushRef.current && Math.random() < dt * 6) {
      const ang = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 9;
      burst(p.position.x + Math.cos(ang) * r, 2.6, p.position.z + Math.sin(ang) * r, '#8d86a8', 3, 0.5);
    }

    // ── 찢어진 페이지: "그만둔다" → 벗어나면 재무장 (수락하면 층이 바뀌며 씬이 사라진다)
    if (secretRetryRef.current !== secretRetrySeen.current) {
      secretRetrySeen.current = secretRetryRef.current;
      secretWaitLeave.current = true;
    }
    if (secretWaitLeave.current && secretPos) {
      if (Math.hypot(p.position.x - secretPos[0], p.position.z - secretPos[1]) > 2.4) {
        secretWaitLeave.current = false;
        secretState.current = 'idle';
      }
    }

    // ── 두 갈래 틈: "그만둔다" → 두 틈에서 벗어나면 재무장 / "들어간다" → 반대편으로 순간이동
    if (riftRetryRef.current !== riftRetrySeen.current) {
      riftRetrySeen.current = riftRetryRef.current;
      riftState.current = 'idle';
      riftWaitLeave.current = true;
    }
    if (riftGoRef.current !== riftGoSeen.current) {
      riftGoSeen.current = riftGoRef.current;
      if (riftPos && riftState.current === 'pending') {
        const from = riftPos[riftFromIdx.current];
        const to = riftPos[1 - riftFromIdx.current];
        burst(from[0], 0.9, from[1], '#b9a3ff', 14, 1.8);
        p.position.x = to[0];
        p.position.z = to[1];
        burst(to[0], 0.9, to[1], '#b9a3ff', 18, 2.0);
        ripple(to[0], to[1], 0.9, '#b9a3ff');
        sfx.portal();
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9); // 도착 자비
        riftState.current = 'idle';
        riftWaitLeave.current = true; // 도착한 틈 위에서 곧장 다시 묻지 않게
      }
    }
    if (riftWaitLeave.current && riftPos) {
      const clear = riftPos.every(
        (rp) => Math.hypot(p.position.x - rp[0], p.position.z - rp[1]) > 2.4,
      );
      if (clear) riftWaitLeave.current = false;
    }

    // 오버레이가 뜨면(=아래 블록이 통째로 멈추면) 모으던 힘도 함께 풀린다.
    // 이걸 안 하면 화면 뒤에서 허밍이 영영 울린다.
    if (pausedRef.current && charge.current > 0) {
      charge.current = 0;
      chargeFullRef.current = false;
      chargeHum.stop();
    }

    if (!pausedRef.current) {
      // ── 결의(무적 대시) 발동 — 게이지가 가득 찬 상태에서 탭/R키가 들어오면 그 순간의
      // 입력 방향(없으면 현재 바라보는 방향)으로 돌진 방향을 고정한다. 대시 중엔 아래
      // 이동 블록이 입력 대신 이 방향을 쓴다 — 눌러 두면 발동 프레임에 방향이 바뀌어도 안전.
      if (resolveActiveRef.current > 0) resolveActiveRef.current = Math.max(0, resolveActiveRef.current - dt);
      if (resolveUiRef.current.ready && resolveTrigger.current) {
        resolveTrigger.current = false;
        resolveUiRef.current = { n: 0, ready: false };
        resolveActiveRef.current = RESOLVE_DASH_DURATION;
        trackAbilityUse('resolve');
        const dd = input.current;
        const dmag = Math.hypot(dd.x, dd.z);
        resolveDirRef.current =
          dmag > 0.01
            ? { x: dd.x / dmag, z: dd.z / dmag }
            : { x: Math.sin(p.rotation.y), z: Math.cos(p.rotation.y) };
        sfx.resolve();
        burst(p.position.x, 0.7, p.position.z, '#ffd166', 18, 2.6);
      }
      const dashingNow = resolveActiveRef.current > 0;

      // ── 플레이어 이동 (그리드 충돌) — 대시 중엔 입력을 무시하고 고정된 방향으로 고속 돌진
      const d = input.current;
      const mag = Math.hypot(d.x, d.z);
      if (dashingNow) {
        const rd = resolveDirRef.current;
        const nx = p.position.x + rd.x * RESOLVE_DASH_SPEED * dt;
        const nz = p.position.z + rd.z * RESOLVE_DASH_SPEED * dt;
        if (canStand(floor.cells, nx, p.position.z, 0.42)) p.position.x = nx;
        if (canStand(floor.cells, p.position.x, nz, 0.42)) p.position.z = nz;
        p.rotation.y = Math.atan2(rd.x, rd.z);
        p.position.y = 0.05;
      } else if (mag > 0.01) {
        const nx = p.position.x + d.x * stats.speed * dt;
        const nz = p.position.z + d.z * stats.speed * dt;
        if (canStand(floor.cells, nx, p.position.z, 0.42)) p.position.x = nx;
        if (canStand(floor.cells, p.position.x, nz, 0.42)) p.position.z = nz;
        p.rotation.y = Math.atan2(d.x, d.z);
        p.position.y = Math.abs(Math.sin(t * 10)) * 0.08; // 달리기 통통
      } else {
        p.position.y = 0;
      }

      // ── 자동 조준 발사 (가장 가까운 적 — 보스·수문장 포함 — 을 노린다)
      // ── 차지 샷 — 누르는 동안 평타를 멈추고 모았다가, 놓으면 무거운 한 방.
      // 자동 조준은 그대로라 '조준'이 아니라 '타이밍'이 플레이어의 몫이 된다.
      const CHARGE_FULL = 0.75; // 완충까지 걸리는 시간(초)
      const wasCharging = charge.current > 0;
      if (chargeHeld.current) {
        if (!wasCharging) chargeHum.start(); // 모으는 소리 — 누르는 동안만 유지되는 유일한 음
        charge.current = Math.min(1, charge.current + dt / CHARGE_FULL);
        chargeHum.set(charge.current);
        // 완충 신호 — 전투 중 시선은 무리에 가 있으니 발밑 링만으론 놓을 때를 못 잡는다
        if (charge.current >= 1 && !chargeFullRef.current) {
          chargeFullRef.current = true;
          sfx.chargeReady();
        }
        fireTimer.current = Math.max(fireTimer.current, 0.02); // 모으는 동안 평타 정지
      } else if (wasCharging) {
        // 놓았다 — 0.35 미만이면 헛손질로 보고 그냥 흘린다(오조작 방지)
        const power = charge.current;
        charge.current = 0;
        chargeFullRef.current = false;
        chargeHum.stop();
        if (power >= 0.35) chargeShotRef.current = power;
      }
      // 결의 대시 중엔 자동 발사도 멈춘다 — 회피에 온전히 쓰는 판단 창(차지 중 정지와 같은 패턴)
      if (dashingNow) fireTimer.current = Math.max(fireTimer.current, 0.02);

      fireTimer.current -= dt;
      if (fireTimer.current <= 0) {
        let tx = 0;
        let tz = 0;
        let bestD = stats.range;
        let hasTarget = false;
        for (const e of enemies.current) {
          if (!e.alive) continue;
          const dist = Math.hypot(e.x - p.position.x, e.z - p.position.z);
          if (dist < bestD) {
            bestD = dist;
            tx = e.x;
            tz = e.z;
            hasTarget = true;
          }
        }
        // 보스도 사거리 안에 있으면 조준 대상 (예전엔 enemies만 봐서 보스를 못 쐈음)
        const bAim = boss.current;
        if (bAim && bAim.alive) {
          const bdist = Math.hypot(bAim.x - p.position.x, bAim.z - p.position.z);
          if (bdist < bestD) {
            bestD = bdist;
            tx = bAim.x;
            tz = bAim.z;
            hasTarget = true;
          }
        }
        if (hasTarget && chargeShotRef.current > 0) {
          // 차지 방출 — 크고 느리지 않은 한 발. 관통 +2, 피해는 배율만큼.
          const power = chargeShotRef.current;
          chargeShotRef.current = 0;
          const ang = Math.atan2(tx - p.position.x, tz - p.position.z);
          const slot = shots.current.find((sh) => !sh.alive);
          if (slot) {
            slot.x = p.position.x;
            slot.z = p.position.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = stats.range * 1.3;
            slot.pierce = stats.pierce + 2;
            slot.bounce = stats.bounce;
            slot.last = -1;
            slot.charge = 1.5 + power * 2.5; // 완충 4배
            slot.alive = true;
          }
          burst(p.position.x, 0.85, p.position.z, '#8de0ff', 12 + Math.round(power * 10), 2.4);
          sfx.blast(power);
          impact(0.3 + power * 0.4, p.position.x, p.position.z, '#8de0ff');
          fireTimer.current = 1 / stats.fireRate;
        } else if (hasTarget) {
          const base = Math.atan2(tx - p.position.x, tz - p.position.z);
          // 진화 「쏟아지는 문장」 — N번째 공격은 부채꼴 9연발
          fanCounter.current++;
          const isFan = stats.fanEvery > 0 && fanCounter.current % stats.fanEvery === 0;
          const nShots = isFan ? 9 : stats.shots;
          const spread = isFan ? 0.24 : 0.16;
          for (let s = 0; s < nShots; s++) {
            const slot = shots.current.find((sh) => !sh.alive);
            if (!slot) break;
            const ang = base + (s - (nShots - 1) / 2) * spread;
            slot.x = p.position.x;
            slot.z = p.position.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = stats.range;
            slot.pierce = stats.pierce;
            slot.bounce = stats.bounce;
            slot.last = -1;
            slot.charge = 0;
            slot.alive = true;
          }
          if (isFan) {
            // 「쏟아지는 문장」 발사 순간 — 골드 스파크 + 확인음 (잿팟이 계속 보이게)
            burst(p.position.x, 0.85, p.position.z, '#ffd166', 8, 1.8);
            sfx.pass();
          }
          fireTimer.current = 1 / stats.fireRate;
        }
      }

      // ── 투사체 (명중 시: 번쩍 + 스파크 + 넉백 — 치명타·관통·탄속 반영)
      const shotSpd = SHOT_SPEED * stats.shotSpeed;
      for (const sh of shots.current) {
        if (!sh.alive) continue;
        sh.x += sh.dx * shotSpd * dt;
        sh.z += sh.dz * shotSpd * dt;
        sh.left -= shotSpd * dt;
        const cx = Math.floor(sh.x / CELL + GRID / 2);
        const cz = Math.floor(sh.z / CELL + GRID / 2);
        if (sh.left <= 0) {
          sh.alive = false;
          continue;
        }
        if (!isFloor(floor.cells, cx, cz)) {
          // 진화 「종이 표창」 — 벽에 한 번 튕긴다 (막힌 축을 판정해 반사)
          if (sh.bounce > 0) {
            sh.bounce -= 1;
            const px2 = sh.x - sh.dx * shotSpd * dt;
            const pz2 = sh.z - sh.dz * shotSpd * dt;
            const cxPrev = Math.floor(px2 / CELL + GRID / 2);
            const czPrev = Math.floor(pz2 / CELL + GRID / 2);
            const blockX = !isFloor(floor.cells, cx, czPrev);
            const blockZ = !isFloor(floor.cells, cxPrev, cz);
            if (blockX) sh.dx = -sh.dx;
            if (blockZ) sh.dz = -sh.dz;
            if (!blockX && !blockZ) {
              sh.dx = -sh.dx;
              sh.dz = -sh.dz;
            }
            sh.x = px2;
            sh.z = pz2;
            burst(sh.x, 0.75, sh.z, '#f4efe0', 2, 0.8);
          } else {
            sh.alive = false;
            continue;
          }
        }
        // 보스 명중
        const bh = boss.current;
        if (bh && bh.alive && Math.hypot(bh.x - sh.x, bh.z - sh.z) < 1.4) {
          const crit = stats.crit > 0 && Math.random() < stats.crit;
          const dmg = stats.damage * (crit ? 2 : 1) * damageMulRef.current;
          bh.hp -= dmg;
          bh.flash = 1;
          sh.alive = false;
          if (crit) sfx.crit();
          else sfx.hit();
          burst(sh.x, 0.9, sh.z, '#e0b3ff', 4, 1.4);
          spawnDmg(bh.x, bh.z, Math.round(dmg), crit ? '#ff8a3d' : undefined);
          // 진화 「마침표」 — 보스 치명타도 주변 잡몹에 폭발
          if (crit && stats.critBoom > 0) {
            burst(bh.x, 1.1, bh.z, '#ff9a3d', 16, 2.4);
            for (const e2 of enemies.current) {
              if (!e2.alive) continue;
              if (Math.hypot(e2.x - bh.x, e2.z - bh.z) < 2.6) {
                e2.hp -= dmg * 0.8;
                e2.flash = 1;
                if (e2.hp <= 0) killEnemy(e2, false);
              }
            }
          }
          onBossHp(Math.max(0, bh.hp), bh.maxHp);
          if (bh.hp <= 0) killBoss();
          continue;
        }
        for (let ei = 0; ei < enemies.current.length; ei++) {
          const e = enemies.current[ei];
          if (!e.alive) continue;
          if (ei === sh.last) continue; // 관통탄이 같은 적을 연속 프레임에 다시 때리지 않게
          if (Math.hypot(e.x - sh.x, e.z - sh.z) < 0.62) {
            const crit = stats.crit > 0 && Math.random() < stats.crit;
            const dmg =
              stats.damage * (crit ? 2 : 1) * damageMulRef.current * (sh.charge > 0 ? sh.charge : 1);
            e.hp -= dmg;
            e.flash = 1;
            if (sh.pierce > 0) {
              sh.pierce -= 1; // 관통 서표 — 꿰뚫고 계속 난다
              sh.last = ei;
            } else {
              sh.alive = false;
            }
            if (crit) sfx.crit();
            else sfx.hit();
            // 타격 순간 — 히트스톱 + 맞은 자리의 충격 링. 치명타는 더 오래 얼려
            // '묵직한 한 방'을 만들고, 링도 더 크고 노랗게 퍼진다.
            impact(
              sh.charge > 0 ? 0.75 : crit ? 0.55 : 0.22,
              e.x,
              e.z,
              crit ? '#ffd166' : '#ffd8a8',
            );
            burst(
              e.x, 0.7, e.z,
              sh.charge > 0 ? '#8de0ff' : '#ffe08a',
              sh.charge > 0 ? 14 : crit ? 8 : 4,
              sh.charge > 0 ? 2.2 : 1.4,
            );
            spawnDmg(e.x, e.z, Math.round(dmg), crit ? '#ff8a3d' : undefined);
            // 진화 「마침표」 — 치명타가 대폭발을 새긴다 (반경 2.6, 주변 80% 피해)
            if (crit && stats.critBoom > 0) {
              burst(e.x, 0.9, e.z, '#ff9a3d', 18, 2.6);
              ripple(e.x, e.z, 1.0, '#ff9a3d');
              for (const e2 of enemies.current) {
                if (!e2.alive || e2 === e) continue;
                if (Math.hypot(e2.x - e.x, e2.z - e.z) < 2.6) {
                  e2.hp -= dmg * 0.8;
                  e2.flash = 1;
                  spawnDmg(e2.x, e2.z, Math.round(dmg * 0.8), '#ff9a3d');
                  if (e2.hp <= 0) killEnemy(e2, false);
                }
              }
            }
            // 넉백 (탱커·수문장은 밀리지 않음, 벽은 통과 못 함) — 밀어내기 배율 반영
            if (e.type !== 'tank' && !e.elite) {
              const kx = e.x + sh.dx * 0.4 * stats.knock;
              const kz = e.z + sh.dz * 0.4 * stats.knock;
              if (canStand(floor.cells, kx, e.z, 0.38)) e.x = kx;
              if (canStand(floor.cells, e.x, kz, 0.38)) e.z = kz;
            }
            if (e.hp <= 0) killEnemy(e, true);
            break;
          }
        }
      }

      // ── 적 AI (타입별) + 접촉 피해 — 내려갈수록 확실히 빨라진다 (스릴 램프)
      // 깊은 층 위협 램프(2026-07-19): 30층부터 '받는 피해'가 추가로 가파르게 —
      // 적 스탯 캡(스폰·속도)이 15~21층에 걸린 뒤에도 아이템은 복리로 쌓여
      // 파밍 빌드가 무적 순항했다 (시뮬 실측: 160아이템 61층 무저항). 피해만 올려
      // 얕은 층(≤30)과 이동·조작 감각은 그대로 둔다.
      const threatFloor =
        (floorNo + Math.max(0, floorNo - 30) * 0.6) *
        (danger ? 1.25 : 1) *
        (surge.current.state === 'active' ? 1.5 : 1);
      // 「마지막 문단」이 도는 동안 적이 광폭화한다 — 속도·피해가 함께 오른다.
      // 지속이 5초로 짧아 '억울한 죽음'이 아니라 '버텨 낸 순간'이 된다.
      const surging = surge.current.state === 'active';
      const espeed = (2.5 + Math.min(3.3, floorNo * 0.16)) * (surging ? 1.45 : 1);

      // ── 찰나(시간 동결) — 게이지가 가득 찬 상태에서 탭/F키가 들어오면 1회 발동.
      // 이 블록(적 AI·보스·탄막) 안에서만 dt를 0으로 가려 세계를 얼린다 — 블록 밖(플레이어
      // 이동·차지 샷 타이머·히트스톱)은 바깥 dt를 그대로 쓰므로 영향받지 않는다.
      if (freezeActiveRef.current > 0) freezeActiveRef.current = Math.max(0, freezeActiveRef.current - dt);
      if (freezeUiRef.current.ready && freezeTrigger.current) {
        freezeTrigger.current = false;
        freezeUiRef.current = { n: 0, ready: false };
        freezeActiveRef.current = FREEZE_DURATION;
        trackAbilityUse('freeze');
        sfx.freeze();
        burst(p.position.x, 1.0, p.position.z, '#bff3ff', 26, 3.0);
        // 저항하는 정예 — 수문장은 찰나에 얼지 않는다. 발동 순간 정예 자리에 붉은 균열을
        // 터뜨려 "이 적은 안 통한다"를 미리 알려 준다(맞고 나서 깨닫는 것보다 나은 신호).
        const resistGuardian = enemies.current.find((e2) => e2.elite && e2.alive);
        if (resistGuardian) {
          ripple(resistGuardian.x, resistGuardian.z, 0.6, '#ff2e1f');
          burst(resistGuardian.x, 1.0, resistGuardian.z, '#ff2e1f', 14, 2.2);
        }
      }
      const worldDt = dt;
      const frozenNow = freezeActiveRef.current > 0;
      {
      const frozenDt = frozenNow ? 0 : worldDt;
      for (const e of enemies.current) {
        if (!e.alive) continue;
        // 정예(수문장)는 찰나에 저항 — 세계가 얼어도 실제 시간(worldDt)으로 움직이고 공격한다.
        const dt = e.elite ? worldDt : frozenDt;
        e.hitCd -= dt;
        const ex = p.position.x - e.x;
        const ez = p.position.z - e.z;
        const dist = Math.hypot(ex, ez);
        const ux = dist > 0.001 ? ex / dist : 0;
        const uz = dist > 0.001 ? ez / dist : 0;
        const walk = (dx: number, dz: number, spd: number) => {
          const nx = e.x + dx * spd * dt;
          const nz = e.z + dz * spd * dt;
          if (canStand(floor.cells, nx, e.z, 0.38)) e.x = nx;
          if (canStand(floor.cells, e.x, nz, 0.38)) e.z = nz;
        };

        if (e.type === 'shooter') {
          // 거리를 유지하며 조준 사격 — 깊을수록 연사가 빨라지고 부채꼴로 여러 발
          e.ai -= dt;
          if (dist < AGGRO + 3) {
            if (dist < 4.5) walk(-ux, -uz, 2.2);
            else if (dist > 8.5) walk(ux, uz, 2.1);
            if (dist < 11 && e.ai <= 0) {
              e.ai = Math.max(1.2, 2.1 - floorNo * 0.06);
              const nShots = floorNo >= 20 ? 3 : floorNo >= 8 ? 2 : 1;
              const baseA = Math.atan2(ux, uz);
              for (let si = 0; si < nShots; si++) {
                const slot = eshots.current.find((s2) => !s2.alive);
                if (!slot) break;
                const ang = baseA + (si - (nShots - 1) / 2) * 0.2;
                slot.x = e.x;
                slot.z = e.z;
                slot.dx = Math.sin(ang);
                slot.dz = Math.cos(ang);
                slot.left = 13;
                slot.alive = true;
              }
            }
          }
        } else if (e.type === 'dasher') {
          // 접근 → 조준(부풀기) → 돌진 → 숨 고르기 (수문장은 더 넓게·빠르게·매섭게)
          const aggroR = e.elite ? AGGRO + 9 : AGGRO;
          const appSpd = e.elite ? 3.3 : 2.8 + Math.min(1.2, floorNo * 0.04);
          const dashSpd = e.elite ? 11.5 : 10 + Math.min(3, floorNo * 0.05);
          if (e.mode === 0) {
            if (dist < aggroR) {
              walk(ux, uz, appSpd);
              if (dist < (e.elite ? 7.5 : 6.5)) {
                e.mode = 1;
                e.ai = e.elite ? 0.45 : 0.55;
              }
            }
          } else if (e.mode === 1) {
            e.ai -= dt;
            if (e.ai <= 0) {
              e.mode = 2;
              e.ai = e.elite ? 0.55 : 0.5;
              e.adx = ux;
              e.adz = uz;
            }
          } else if (e.mode === 2) {
            e.ai -= dt;
            walk(e.adx, e.adz, dashSpd);
            if (e.ai <= 0) {
              e.mode = 3;
              e.ai = e.elite ? 0.8 : 1.1;
            }
          } else {
            e.ai -= dt;
            if (e.ai <= 0) e.mode = 0;
          }
        } else {
          // chaser / tank — 우직하게 접근 (탱커도 깊을수록 조금씩 빨라진다)
          const spd = e.type === 'tank' ? 1.6 + Math.min(1.4, floorNo * 0.05) : espeed;
          if (dist < AGGRO) walk(ux, uz, spd);
        }

        const touchR = e.elite ? 1.25 : e.type === 'tank' ? 1.05 : 0.85;
        // 정예는 얼어 있는 동안에도 접촉 피해가 들어간다 — 그 외 적은 기존처럼 얼면 무해.
        if ((!frozenNow || e.elite) && dist < touchR && e.hitCd <= 0) {
          let dmg: number;
          if (e.elite) {
            // 수문장: 돌진 강타는 HP를 크게 깎는다 (깊이 내려갈수록 위협적)
            e.hitCd = e.mode === 2 ? 0.7 : 1.0;
            dmg =
              e.mode === 2 ? Math.round(16 + threatFloor * 0.9) : Math.round(9 + threatFloor * 0.5);
          } else {
            e.hitCd = e.type === 'dasher' && e.mode === 2 ? 0.6 : 0.8;
            dmg =
              e.type === 'tank'
                ? Math.round((6 + threatFloor) * 1.5)
                : e.type === 'dasher' && e.mode === 2
                  ? Math.round(8 + threatFloor)
                  : Math.round(6 + threatFloor);
          }
          const applied = hurtPlayer(dmg); // 회피·방어 반영 (회피 시 0)
          // 피격 — 파문이 **내 발밑**에서 붉게 퍼진다 (때릴 때는 적 자리, 맞을 때는 내 자리라
          //        색과 위치만으로 '쳤다/맞았다'가 구분된다. 화면 붉은 비네트는 App이 따로 켠다)
          if (applied > 0) {
            impact(e.elite ? 0.8 : 0.5, p.position.x, p.position.z, '#ff5d6e');
            burst(
              p.position.x,
              0.8,
              p.position.z,
              e.elite ? '#ff2030' : '#ff4d5e',
              e.elite ? 12 : 6,
              e.elite ? 2.2 : 1.6,
            );
            if (e.elite) spawnDmg(p.position.x, p.position.z, applied, '#ff5566'); // 큰 피해를 숫자로 보여줌
            // 저항하는 정예에게 얼어붙은 채로 맞으면 찰나 자원을 도둑맞는다 — "얼려도 정예
            // 근처는 안전하지 않다"는 위험 신호. 결의 무적 중엔 애초에 applied가 0이라 안 탄다.
            if (e.elite && frozenNow) {
              freezeActiveRef.current = Math.max(0, freezeActiveRef.current - FREEZE_STEAL);
              burst(p.position.x, 1.1, p.position.z, '#7fe8ff', 8, 1.6);
            }
          }
          // 가시 문장 — 몸에 닿은 적에게 반사 피해 (회피 여부와 무관하게 접촉이면 발동)
          if (stats.thorns > 0) {
            e.hp -= stats.thorns;
            e.flash = 1;
            spawnDmg(e.x, e.z, Math.round(stats.thorns), '#8de07a');
            if (e.hp <= 0) killEnemy(e, true);
          }
        }
      }

      // ── 보스 (10층마다): 10층 주기로 패턴 순환 — radial(방사 탄막) / summon(소환) / charge(돌진).
      //    공통: 저체력 40% 미만 광폭화, 접촉 강타.
      const bAi = boss.current;
      if (bAi && bAi.alive) {
        bAi.hitCd -= frozenDt;
        bAi.fireTimer -= frozenDt;
        const bx = p.position.x - bAi.x;
        const bz = p.position.z - bAi.z;
        const bd = Math.hypot(bx, bz);
        const rage = bAi.hp < bAi.maxHp * 0.4 ? 0.72 : 1; // 광폭화 페이즈
        const fireRing = (n: number, reach: number) => {
          for (let k = 0; k < n; k++) {
            const slot = eshots.current.find((s2) => !s2.alive);
            if (!slot) break;
            const ang = (k / n) * Math.PI * 2 + t;
            slot.x = bAi.x;
            slot.z = bAi.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = reach;
            slot.alive = true;
          }
        };

        if (bossVariant === 'charge' && bd < 18 && bd > 0.001) {
          // 돌진형 — 느리게 접근 → 부풀며 조준 → 강돌진 → 착지 링 탄막 → 숨 고르기
          if (bAi.mode === 0) {
            const nx = bAi.x + (bx / bd) * 1.7 * frozenDt;
            const nz = bAi.z + (bz / bd) * 1.7 * frozenDt;
            if (canStand(floor.cells, nx, bAi.z, 0.9)) bAi.x = nx;
            if (canStand(floor.cells, bAi.x, nz, 0.9)) bAi.z = nz;
            if (bAi.fireTimer <= 0) {
              bAi.fireTimer = Math.max(1.6, 2.4 - floorNo * 0.012) * rage;
              fireRing(6, 12);
            }
            if (bd < 9) {
              bAi.mode = 1;
              bAi.ai = 0.75 * rage;
            }
          } else if (bAi.mode === 1) {
            bAi.ai -= frozenDt;
            if (bAi.ai <= 0) {
              bAi.mode = 2;
              bAi.ai = 0.55;
              bAi.adx = bx / bd;
              bAi.adz = bz / bd;
              sfx.roar();
            }
          } else if (bAi.mode === 2) {
            bAi.ai -= frozenDt;
            const nx = bAi.x + bAi.adx * 13 * frozenDt;
            const nz = bAi.z + bAi.adz * 13 * frozenDt;
            if (canStand(floor.cells, nx, bAi.z, 0.9)) bAi.x = nx;
            if (canStand(floor.cells, bAi.x, nz, 0.9)) bAi.z = nz;
            if (bAi.ai <= 0) {
              bAi.mode = 3;
              bAi.ai = 1.0 * rage;
              fireRing(10, 10); // 착지 충격 링
              ripple(bAi.x, bAi.z, 1.1, '#c06bff');
              burst(bAi.x, 0.8, bAi.z, '#c06bff', 14, 2.2);
            }
          } else {
            bAi.ai -= frozenDt;
            if (bAi.ai <= 0) bAi.mode = 0;
          }
        } else if (bd < 16 && bd > 0.001) {
          // radial(기본)·summon 공통 — 추격
          const nx = bAi.x + (bx / bd) * 2.3 * frozenDt;
          const nz = bAi.z + (bz / bd) * 2.3 * frozenDt;
          if (canStand(floor.cells, nx, bAi.z, 0.9)) bAi.x = nx;
          if (canStand(floor.cells, bAi.x, nz, 0.9)) bAi.z = nz;
          if (bAi.fireTimer <= 0) {
            bAi.fireTimer = Math.max(1.3, 2.0 - floorNo * 0.012) * rage;
            bAi.volley++;
            if (bossVariant === 'summon' && bAi.volley % 2 === 0) {
              // 소환형 — "책이 죽은 몬스터를 다시 쓴다": 죽은 슬롯 3기를 보스 곁에 되살림
              let revived = 0;
              for (const e2 of enemies.current) {
                if (e2.alive || e2.elite) continue;
                const ang = Math.random() * Math.PI * 2;
                const sx2 = bAi.x + Math.sin(ang) * 2.2;
                const sz2 = bAi.z + Math.cos(ang) * 2.2;
                if (!canStand(floor.cells, sx2, sz2, 0.38)) continue;
                e2.x = sx2;
                e2.z = sz2;
                e2.type = 'chaser';
                e2.hp = 14 + floorNo * 3; // 소환수는 약하다 (물량이 위협)
                e2.alive = true;
                e2.flash = 1;
                e2.hitCd = 0.6;
                burst(sx2, 0.7, sz2, '#c06bff', 8, 1.4);
                if (++revived >= 3) break;
              }
              sfx.unlock();
            } else {
              const nB = floorNo >= 60 ? 14 : floorNo >= 30 ? 12 : 10;
              fireRing(bossVariant === 'summon' ? nB - 3 : nB, 15);
              sfx.roar();
            }
          }
        }
        if (!frozenNow && bd < 1.6 && bAi.hitCd <= 0) {
          bAi.hitCd = 1.0;
          const heavy = bossVariant === 'charge' && bAi.mode === 2; // 돌진 강타
          if (hurtPlayer((heavy ? 22 : 16) + Math.round(threatFloor * 0.7)) > 0) {
            ripple(p.position.x, p.position.z, heavy ? 1.1 : 0.8, '#ff5d6e');
            burst(p.position.x, 0.8, p.position.z, '#ff4d5e', 8, 1.8);
          }
        }
      }

      // ── 적 탄막 (슈터·보스 공용, 플레이어 피격) — 깊을수록 탄속도 빨라진다
      const eshotSpd = ESHOT_SPEED + Math.min(3, floorNo * 0.08);
      for (const es of eshots.current) {
        if (!es.alive) continue;
        es.x += es.dx * eshotSpd * frozenDt;
        es.z += es.dz * eshotSpd * frozenDt;
        es.left -= eshotSpd * frozenDt;
        const ecx = Math.floor(es.x / CELL + GRID / 2);
        const ecz = Math.floor(es.z / CELL + GRID / 2);
        if (es.left <= 0 || !isFloor(floor.cells, ecx, ecz)) {
          es.alive = false;
          continue;
        }
        if (!frozenNow && Math.hypot(es.x - p.position.x, es.z - p.position.z) < 0.55) {
          es.alive = false;
          if (hurtPlayer(7 + Math.round(threatFloor * 0.4)) > 0) {
            ripple(p.position.x, p.position.z, 0.5, '#ff5d6e');
            burst(p.position.x, 0.8, p.position.z, '#ff4d5e', 5, 1.4);
          }
        }
      }
      } // ── 찰나 블록(dt 가림) 끝

      // ── 보물상자 접촉 → 수수께끼
      if (chestState.current === 'idle' && chestPos) {
        if (Math.hypot(p.position.x - chestPos[0], p.position.z - chestPos[1]) < 1.05) {
          chestState.current = 'pending';
          onChest();
        }
      }

      // ── 마을 문 접촉 → 들어갈지 선택
      if (homeState.current === 'idle' && homePos) {
        if (Math.hypot(p.position.x - homePos[0], p.position.z - homePos[1]) < 1.05) {
          homeState.current = 'pending';
          onHomeDoor();
        }
      }

      // ── 소녀의 흔적 발견 (1회)
      if (tracePos && !traceSeen.current) {
        if (Math.hypot(p.position.x - tracePos[0], p.position.z - tracePos[1]) < 1.0) {
          traceSeen.current = true;
          burst(tracePos[0], 0.8, tracePos[1], '#ffb3d1', 10, 1.2);
          onTrace();
        }
      }

      // ── 56층의 소녀 (다가가면 대화, 층당 1회)
      if (girlPos && !girlMet.current) {
        if (Math.hypot(p.position.x - girlPos[0], p.position.z - girlPos[1]) < 1.3) {
          girlMet.current = true;
          burst(girlPos[0], 1.0, girlPos[1], '#ffd9a8', 8, 1.0);
          onGirl();
        }
      }

      // ── 제단 접촉 → 바칠지 선택
      if (altarState.current === 'idle' && altarPos) {
        if (Math.hypot(p.position.x - altarPos[0], p.position.z - altarPos[1]) < 1.05) {
          altarState.current = 'pending';
          onAltar();
        }
      }

      // ── 찢어진 페이지 접촉 → 건너뛸지 선택
      if (secretState.current === 'idle' && secretPos) {
        if (Math.hypot(p.position.x - secretPos[0], p.position.z - secretPos[1]) < 1.05) {
          secretState.current = 'pending';
          onSecret();
        }
      }

      // ── 두 갈래 틈 접촉 → 들어갈지 선택
      if (riftPos && riftState.current === 'idle' && !riftWaitLeave.current) {
        for (let ri = 0; ri < riftPos.length; ri++) {
          if (Math.hypot(p.position.x - riftPos[ri][0], p.position.z - riftPos[ri][1]) < 1.0) {
            riftState.current = 'pending';
            riftFromIdx.current = ri;
            onRift();
            break;
          }
        }
      }

      // ── 무너지는 서가 접촉 → 흔들지 선택
      if (collapseState.current === 'idle' && collapsePos) {
        if (Math.hypot(p.position.x - collapsePos[0], p.position.z - collapsePos[1]) < 1.15) {
          collapseState.current = 'pending';
          onCollapse();
        }
      }

      // ── 몬스터 하우스 코인 무더기 — 몸으로 줍기 (오버레이 없이 흐름 유지)
      orbPos.forEach((op, i) => {
        if (orbTaken.current[i]) return;
        if (Math.hypot(p.position.x - op[0], p.position.z - op[1]) < 0.9) {
          orbTaken.current[i] = true;
          burst(op[0], 0.8, op[1], '#ffd166', 12, 1.8);
          onCoins(5 + Math.floor(floorNo / 2));
          // 아레나의 「보석 1·2개째 임시 버프」를 몬스터 하우스로 이식 — 3번째(마지막)는
          // 곧바로 클리어라 버프를 줘도 쓸 데가 없어 아레나와 동일하게 건너뛴다.
          if (i === 0 || i === 1) onHouseBuff(i + 1);
        }
      });

      // ── 좀먹은 바닥 — 밟으면 소량 피해 + 넉백, 칸마다 1회만 (덫을 '해체'한 셈)
      if (mirePos) {
        for (let mi = 0; mi < mirePos.length; mi++) {
          if (mireHit.current[mi]) continue;
          const [mx, mz] = mirePos[mi];
          if (Math.hypot(p.position.x - mx, p.position.z - mz) < 0.85) {
            mireHit.current[mi] = true;
            const applied = hurtPlayer(Math.round(5 + threatFloor * 0.3));
            if (applied > 0) {
              impact(0.5, p.position.x, p.position.z, '#6b5a3a');
              burst(mx, 0.3, mz, '#6b5a3a', 10, 1.6);
            }
          }
        }
      }

      // ── 상자 대기 반짝임
      if (chestState.current === 'idle' && chestPos) {
        sparkleTimer.current -= dt;
        if (sparkleTimer.current <= 0) {
          sparkleTimer.current = 0.55;
          burst(chestPos[0] + (Math.random() - 0.5) * 0.6, 1.0, chestPos[1] + (Math.random() - 0.5) * 0.6, '#ffd166', 1, 0.5);
        }
      }

      // ── 「마지막 문단」 — 출구에 다가서면 층이 한 번 저항한다 (8층+ 비보스, 층당 1회)
      const exitDist = Math.hypot(p.position.x - exitX, p.position.z - exitZ);
      if (surge.current.state === 'idle' && !isBossFloor && floorNo >= 8 && exitDist < 7) {
        surge.current.state = 'active';
        surge.current.t = SURGE_SECONDS + Math.min(2.5, floorNo / 16);
        sfx.roar();
        impact(0.9, exitX, exitZ, '#ff3d5e');
        burst(exitX, 1.2, exitZ, '#ff3d5e', 26, 3.0);
        onSurge(surge.current.t);
        // 증원 — **절반은 출구를 막고, 절반은 주인공을 에워싼다.**
        // 출구 주변에만 세웠더니 뒤로 물러나면 평소 전투가 돼 버렸다(실측: 사망률 0/11).
        // 물러날 곳이 없어야 '버티기'가 아니라 '돌파'가 된다.
        for (const e of enemies.current) if (e.alive) e.hitCd = Math.min(e.hitCd, 0.3);
        const reinforce = Math.min(12, Math.round(5 + floorNo / 6)); // 깊을수록 더 몰려온다
        let added = 0;
        for (const e of enemies.current) {
          if (added >= reinforce) break;
          if (e.alive) continue;
          const aroundPlayer = added % 2 === 1;
          for (let tries = 0; tries < 14; tries++) {
            const a = Math.random() * Math.PI * 2;
            // 주인공 주위는 즉사 거리를 피해 조금 떨어뜨린다 (기습이 아니라 포위)
            const r = aroundPlayer ? 7 + Math.random() * 2.5 : 6 + Math.random() * 3;
            const ox = aroundPlayer ? p.position.x : exitX;
            const oz = aroundPlayer ? p.position.z : exitZ;
            const nx = ox + Math.cos(a) * r;
            const nz = oz + Math.sin(a) * r;
            if (!canStand(floor.cells, nx, nz, 0.38)) continue;
            e.x = nx;
            e.z = nz;
            e.type = pickEnemyType(floorNo);
            const dm = 1 + Math.pow(Math.max(0, floorNo - 25) / 25, 2) * 2.5;
            const bh2 = (18 + floorNo * 7) * dm;
            e.hp = e.type === 'tank' ? bh2 * 2.8 : e.type === 'shooter' ? bh2 * 0.8 : bh2;
            e.alive = true;
            e.hitCd = 0.6;
            e.flash = 1;
            e.mode = 0;
            e.ai = Math.random() * 1.2;
            burst(nx, 0.8, nz, '#ff3d5e', 6, 1.6);
            added++;
            break;
          }
        }
      }
      if (surge.current.state === 'active') {
        surge.current.t -= dt;
        if (surge.current.t <= 0) {
          surge.current.state = 'done';
          sfx.unlock(); // 해소 — 문단이 끝나고 포털이 다시 열린다
          burst(exitX, 1.2, exitZ, '#b9a3ff', 22, 2.6);
          onSurge(0);
        }
      }

      // ── 출구 포털 (보스 층에서는 보스를 쓰러뜨려야 열린다.
      //     「마지막 문단」이 도는 동안에는 잉크가 뭉개져 포털이 잠긴다 — 버텨야 열린다)
      const openNow = !exited.current && bossDead.current && surge.current.state !== 'active';
      if (openNow && exitDist < 1.3) {
        exited.current = true;
        onExit();
      }
      // 🔥 모험의 길 — 붉은 포털. 판정 반경을 보통 포털보다 좁게(1.1) 잡는다:
      // 스치기만 해도 사나운 층으로 끌려가면 '선택'이 아니라 사고가 된다.
      if (openNow && forkPos) {
        const fd = Math.hypot(p.position.x - forkPos[0], p.position.z - forkPos[1]);
        if (fd < 1.1) {
          exited.current = true;
          burst(forkPos[0], 1.2, forkPos[1], '#ff5d4d', 22, 2.6);
          onExit(true);
        }
      }
    }

    // ── 파티클 물리 (일시정지 중에도 여운은 흐르게)
    for (const pt of particles.current) {
      if (!pt.alive) continue;
      pt.ttl -= dt;
      if (pt.ttl <= 0) {
        pt.alive = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.z += pt.vz * dt;
      pt.y += pt.vy * dt;
      pt.vy -= 9 * dt;
      if (pt.y < 0.05) {
        pt.y = 0.05;
        pt.vy *= -0.35;
      }
    }

    // ── 동적 인스턴스 갱신
    const km = enemyKindRefs.current;
    const esh = enemyShadowRef.current;
    if (km.chaser) {
      // 타입별 메시에 나눠 담는다 — 각 메시의 쓰기 위치를 따로 센다
      const kn: Record<EnemyKind, number> = { chaser: 0, shooter: 0, dasher: 0, tank: 0, elite: 0 };
      enemies.current.forEach((e, i) => {
        if (e.alive) {
          e.flash = Math.max(0, e.flash - dt * 6);
          dummy.position.set(e.x, 0.55 + Math.sin(t * 4 + e.wobble) * 0.1, e.z);
          dummy.rotation.set(0, t * 1.5 + e.wobble, 0);
          // 타입별 실루엣·색: 탱커 크고 어둡게, 슈터 작고 밝게, 대셔 길쭉하게
          let sx = 1;
          let sy = 1;
          let sz = 1;
          palette.tmp.copy(palette.enemyBase);
          if (e.elite) {
            // 수문장 — 크고 진홍빛, 돌진 시 납작하게 길어짐
            sx = 1.9;
            sz = 1.9;
            sy = 2.0;
            if (e.mode === 1) sy = 2.0 + Math.sin(t * 24) * 0.16; // 조준 중 부들부들
            if (e.mode === 2) {
              sz = 2.5;
              sy = 1.5;
            }
            palette.tmp.copy(palette.elite);
          } else if (e.type === 'tank') {
            sx = sy = sz = 1.55;
            palette.tmp.multiplyScalar(0.62);
          } else if (e.type === 'shooter') {
            sx = sy = sz = 0.82;
            palette.tmp.lerp(palette.shotTiers[0], 0.4);
          } else if (e.type === 'dasher') {
            sx = 0.72;
            sz = 0.72;
            sy = 1.28;
            if (e.mode === 1) sy = 1.28 + Math.sin(t * 26) * 0.18; // 조준 중 부들부들
            if (e.mode === 2) {
              sz = 1.4;
              sy = 0.85;
            }
          }
          const squash = 1 + e.flash * 0.25; // 맞는 순간 살짝 부풀며 번쩍
          dummy.scale.set(sx * squash, sy * squash, sz * squash);
          // 진행 방향을 바라보게 — 실루엣(포신·쐐기·어깨)이 '앞'을 가져야 기능이 읽힌다
          const fx = p.position.x - e.x;
          const fz = p.position.z - e.z;
          if (fx * fx + fz * fz > 0.01) dummy.rotation.set(0, Math.atan2(fx, fz), 0);
          palette.tmp.lerp(palette.white, e.flash);
          const kind: EnemyKind = e.elite ? 'elite' : e.type;
          const mesh = km[kind];
          if (mesh) {
            const idx = kn[kind]++;
            dummy.updateMatrix();
            mesh.setMatrixAt(idx, dummy.matrix);
            mesh.setColorAt(idx, palette.tmp);
          }
        }
        if (!e.alive) {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
          dummy.updateMatrix();
        }
        // 발밑 블롭 섀도우 — 타입 실루엣 크기에 맞춰 접지감 (죽은 적은 위 히든 매트릭스 재사용)
        if (esh) {
          if (e.alive) {
            const ss = e.elite ? 2.2 : e.type === 'tank' ? 1.5 : e.type === 'shooter' ? 0.85 : 1;
            dummy.position.set(e.x, 0.02, e.z);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(ss, ss, 1);
            dummy.updateMatrix();
          }
          esh.setMatrixAt(i, dummy.matrix);
        }
      });
      for (const k of Object.keys(kn) as EnemyKind[]) {
        const mesh = km[k];
        if (!mesh) continue;
        mesh.count = kn[k];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (esh) esh.instanceMatrix.needsUpdate = true;
    }

    // ── 출구 수문장 발치의 붉은 광원 (살아있을 때만, 은은히 맥동)
    if (eliteLightRef.current) {
      const guardian = enemies.current.find((e) => e.elite && e.alive);
      if (guardian) {
        eliteLightRef.current.visible = true;
        eliteLightRef.current.position.set(guardian.x, 1.4, guardian.z);
        eliteLightRef.current.intensity = 2.2 + Math.sin(t * 6) * 0.6 + guardian.flash * 2.5;
      } else {
        eliteLightRef.current.visible = false;
      }
    }

    const sm = shotMeshRef.current;
    if (sm) {
      const tier = stats.damage < 16 ? 0 : stats.damage < 28 ? 1 : 2;
      const shotScale = Math.min(1.9, 1 + (stats.damage / 10 - 1) * 0.3);
      shots.current.forEach((sh, i) => {
        if (sh.alive) {
          dummy.position.set(sh.x, 0.75, sh.z);
          // 진행 방향으로 길게 늘여 궤적감 (탄환 → 빛줄기)
          dummy.rotation.set(0, Math.atan2(sh.dx, sh.dz), 0);
          dummy.scale.set(shotScale, shotScale, shotScale * 2.1);
          sm.setColorAt(i, palette.shotTiers[tier]);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      });
      sm.instanceMatrix.needsUpdate = true;
      if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    }

    const pm = particleMeshRef.current;
    if (pm) {
      particles.current.forEach((pt, i) => {
        if (pt.alive) {
          const s = pt.size * (pt.ttl / pt.max);
          dummy.position.set(pt.x, pt.y, pt.z);
          dummy.rotation.set(pt.ttl * 5, pt.ttl * 7, 0);
          dummy.scale.set(s, s, s);
          pm.setColorAt(i, pt.color);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        pm.setMatrixAt(i, dummy.matrix);
      });
      pm.instanceMatrix.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
    }

    // ── 임팩트 파문 — 맞은 자리에서 퍼지는 충격 링 (카메라 셰이크 대체)
    // 반지름은 빠르게 벌어지고 밝기는 제곱으로 죽는다 = 순간적으로 '탁' 하고 터졌다 사라진다.
    const rm = rippleMeshRef.current;
    if (rm) {
      ripples.current.forEach((rp, i) => {
        if (rp.alive) {
          rp.ttl -= dt;
          if (rp.ttl <= 0) rp.alive = false;
        }
        if (rp.alive) {
          const k = rp.ttl / rp.max; // 1 → 0
          const r = rp.r0 + (rp.r1 - rp.r0) * (1 - k * k); // 처음이 가장 빠르다
          dummy.position.set(rp.x, 0.07, rp.z);
          dummy.rotation.set(-Math.PI / 2, 0, 0); // 링을 바닥에 눕힌다
          dummy.scale.set(r, r, 1);
          rm.setColorAt(i, rippleTmp.copy(rp.color).multiplyScalar(k * k));
        } else {
          dummy.position.set(0, -10, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        rm.setMatrixAt(i, dummy.matrix);
      });
      rm.instanceMatrix.needsUpdate = true;
      if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
    }

    // ── 보스 렌더 (피격 번쩍 + 부유)
    const bR = boss.current;
    const bm = bossMeshRef.current;
    if (bm && bR) {
      if (bR.alive) {
        bR.flash = Math.max(0, bR.flash - dt * 5);
        bm.position.set(bR.x, 1.35 + Math.sin(t * 2.2) * 0.15, bR.z);
        bm.rotation.y = t * 0.8;
        // 돌진형 조준 중엔 부들부들 (대셔와 같은 예고 문법)
        const tremble = bossVariant === 'charge' && bR.mode === 1 ? Math.sin(t * 26) * 0.08 : 0;
        bm.scale.setScalar(1 + bR.flash * 0.12 + tremble);
        if (bossMatRef.current) {
          palette.tmp.copy(palette.enemyBase).lerp(palette.white, bR.flash);
          bossMatRef.current.color.copy(palette.tmp);
        }
        if (bossShadowRef.current) {
          bossShadowRef.current.position.set(bR.x, 0.02, bR.z);
          // 부유 높이에 따라 그림자가 살짝 줄었다 커진다
          bossShadowRef.current.scale.setScalar(1 - Math.sin(t * 2.2) * 0.08);
        }
      } else {
        bm.scale.setScalar(0.0001);
        if (bossShadowRef.current) bossShadowRef.current.scale.setScalar(0.0001);
      }
    }

    // ── 보스 탄막 렌더 (진행 방향으로 살짝 늘여 위협감)
    const esm = eshotMeshRef.current;
    if (esm) {
      eshots.current.forEach((es, i) => {
        if (es.alive) {
          dummy.position.set(es.x, 0.8, es.z);
          dummy.rotation.set(0, Math.atan2(es.dx, es.dz), 0);
          dummy.scale.set(1, 1, 1.55);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        esm.setMatrixAt(i, dummy.matrix);
      });
      esm.instanceMatrix.needsUpdate = true;
    }

    // ── 포털 봉인: 보스 생존 중엔 숨김, 처치 시 자라나며 등장
    if (portalRef.current) {
      const target = bossDead.current ? 1 : 0.0001;
      portalRef.current.scale.setScalar(
        portalRef.current.scale.x + (target - portalRef.current.scale.x) * Math.min(1, dt * 5),
      );
    }
    // 붉은 포털도 같은 봉인을 따르고, 대신 더 사납게 뛴다 (같은 자리에 둘이 서 있으니 구분이 먼저)
    if (forkRef.current) {
      const target = bossDead.current ? 1 : 0.0001;
      forkRef.current.scale.setScalar(
        forkRef.current.scale.x + (target - forkRef.current.scale.x) * Math.min(1, dt * 5),
      );
      forkRef.current.rotation.y = -t * 2.1;
      forkRef.current.position.y = 1.1 + Math.sin(t * 3.1) * 0.18;
    }

    // ── 데미지 숫자 (떠오르며 사라짐)
    dmgNums.current.forEach((d, i) => {
      const sp = dmgSprites.current[i];
      if (!sp) return;
      if (d.alive) {
        d.ttl -= dt;
        if (d.ttl <= 0) {
          d.alive = false;
          sp.visible = false;
          return;
        }
        d.y += 1.7 * dt;
        sp.visible = true;
        sp.position.set(d.x, d.y, d.z);
        const a = d.ttl / d.max;
        (sp.material as THREE.SpriteMaterial).opacity = Math.min(1, a * 1.6);
      } else {
        sp.visible = false;
      }
    });

    // ── 나침반 화살표 (멀리 있는 목표의 방향을 플레이어 곁에 표시)
    const aimArrow = (
      ref: React.RefObject<THREE.Group>,
      target: [number, number] | null,
      active: boolean,
      orbit: number,
    ) => {
      const g = ref.current;
      if (!g) return;
      if (!target || !active || hiddenRef.current) {
        g.visible = false;
        return;
      }
      const dx = target[0] - p.position.x;
      const dz = target[1] - p.position.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 7) {
        g.visible = false;
        return;
      }
      g.visible = true;
      const ang = Math.atan2(dx, dz);
      g.position.set(
        p.position.x + Math.sin(ang) * orbit,
        0.14 + Math.sin(t * 3) * 0.05,
        p.position.z + Math.cos(ang) * orbit,
      );
      g.rotation.y = ang;
    };
    aimArrow(portalArrowRef, [exitX, exitZ], true, 1.9);
    aimArrow(chestArrowRef, chestPos, chestState.current === 'idle', 2.35);
    aimArrow(homeArrowRef, homePos, homeState.current === 'idle', 2.8);
    aimArrow(girlArrowRef, girlPos, !girlMet.current, 3.25);

    // ── 흔적·소녀 연출
    if (traceRef.current) {
      const target = traceSeen.current ? 0.0001 : 1;
      traceRef.current.scale.setScalar(
        traceRef.current.scale.x + (target - traceRef.current.scale.x) * Math.min(1, dt * 8),
      );
      traceRef.current.position.y = Math.sin(t * 2.4) * 0.08;
    }
    if (girlRef.current) {
      girlRef.current.position.y = Math.abs(Math.sin(t * 2)) * 0.04; // 콧노래 부르듯 들썩들썩
    }

    // ── 마을 문 연출 (사용 후 소멸)
    const hd = homeDoorRef.current;
    if (hd) {
      const target = homeState.current === 'used' ? 0.0001 : 1;
      hd.scale.setScalar(hd.scale.x + (target - hd.scale.x) * Math.min(1, dt * 8));
      hd.position.y = Math.sin(t * 1.6) * 0.05;
    }

    // ── 방 이벤트 연출: 제단(바치면 소멸)·찢어진 페이지(팔랑팔랑)·코인 무더기(반짝 회전)
    if (altarRef.current) {
      const target = altarState.current === 'used' ? 0.0001 : 1;
      altarRef.current.scale.setScalar(
        altarRef.current.scale.x + (target - altarRef.current.scale.x) * Math.min(1, dt * 8),
      );
    }
    // 무너지는 서가 — 흔든 순간 기울어 쓰러지며 사라진다
    if (collapseRef.current) {
      const used = collapseState.current === 'used';
      const target = used ? 0.0001 : 1;
      collapseRef.current.scale.setScalar(
        collapseRef.current.scale.x + (target - collapseRef.current.scale.x) * Math.min(1, dt * 3.5),
      );
      collapseRef.current.rotation.z += ((used ? 1.3 : 0.09) - collapseRef.current.rotation.z) * Math.min(1, dt * 3);
      if (!used) collapseRef.current.position.x = collapsePos![0] + Math.sin(t * 9) * 0.012; // 위태로운 흔들림
    }
    if (secretRef.current) {
      secretRef.current.rotation.y = Math.sin(t * 0.9) * 0.3;
      secretRef.current.position.y = 1.05 + Math.sin(t * 1.7) * 0.12;
    }
    // 두 갈래 틈 — 숨쉬듯 일렁임
    riftRefs.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y = t * 0.7 + i * 1.6;
      g.position.y = 1.0 + Math.sin(t * 1.5 + i * 2.1) * 0.1;
      const sc = 1 + Math.sin(t * 3.1 + i) * 0.07;
      g.scale.set(sc, 1 / sc, 1);
    });
    orbRefs.current.forEach((g, i) => {
      if (!g) return;
      if (orbTaken.current[i]) {
        g.scale.setScalar(0.0001);
      } else {
        g.rotation.y = t * 2.2;
        g.position.y = 0.5 + Math.sin(t * 3 + i * 2) * 0.08;
      }
    });

    // ── 보물상자 연출 (개봉·실패 시 사라짐)
    const ch = chestRef.current;
    if (ch) {
      const open = chestState.current === 'opened' || chestState.current === 'failed';
      const target = open ? 0.0001 : 1;
      const cur = ch.scale.x + (target - ch.scale.x) * Math.min(1, dt * 10);
      ch.scale.setScalar(cur);
      ch.rotation.y = Math.sin(t * 1.3) * 0.12;
      ch.position.y = Math.abs(Math.sin(t * 2.2)) * 0.06;
    }

    // ── 획득한 힘의 시각화: 궤도 구슬(멀티샷), 몸집(체력), 황금 잔광(보물)
    const orbCount = Math.min(4, stats.shots - 1);
    orbs.current.forEach((orb, i) => {
      if (!orb) return;
      if (i < orbCount) {
        const ang = t * 2.4 + (i * Math.PI * 2) / Math.max(1, orbCount);
        orb.position.set(Math.sin(ang) * 0.72, 1.05 + Math.sin(t * 3 + i) * 0.08, Math.cos(ang) * 0.72);
        orb.scale.setScalar(1);
      } else {
        orb.scale.setScalar(0.0001);
      }
    });
    if (bodyRef.current) {
      bodyRef.current.scale.setScalar(1 + Math.min(0.18, (stats.maxHp - 100) / 500));
    }
    glowTimer.current = Math.max(0, glowTimer.current - dt);
    if (glowRef.current) {
      glowRef.current.intensity = glowTimer.current * 3.2;
    }

    // ── 진화 「합본」 획득 순간 — 확실한 대형 연출 (금-장미 이중 폭발 + 잔광 + 셰이크)
    if (evoFxRef && evoFxRef.current !== evoFxSeen.current) {
      evoFxSeen.current = evoFxRef.current;
      burst(p.position.x, 0.9, p.position.z, '#ffd166', 26, 3.2);
      burst(p.position.x, 1.3, p.position.z, '#ff9ec4', 18, 2.4);
      burst(p.position.x, 0.6, p.position.z, '#ffffff', 10, 1.6);
      ripple(p.position.x, p.position.z, 1.4, '#ffd166');
      glowTimer.current = 2.6; // 황금 잔광 길게
      for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 1.2); // 감상할 자비
    }

    // ── 진화 보유 상시 표시 — 발밑 금빛 룬 링 (보유 수만큼 크고 밝게)
    if (evoRingRef.current) {
      const evoN =
        (stats.fanEvery > 0 ? 1 : 0) +
        (stats.bounce > 0 ? 1 : 0) +
        (stats.critBoom > 0 ? 1 : 0) +
        (stats.shockwave > 0 ? 1 : 0) +
        (stats.royalty > 0 ? 1 : 0);
      if (evoN > 0) {
        evoRingRef.current.visible = true;
        evoRingRef.current.rotation.z = t * 0.9;
        const s = 1 + (evoN - 1) * 0.12 + Math.sin(t * 2.6) * 0.04;
        evoRingRef.current.scale.setScalar(s);
        (evoRingRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
          0.8 + evoN * 0.25 + Math.sin(t * 3.4) * 0.2;
      } else {
        evoRingRef.current.visible = false;
      }
    }

    // 차지 링 — 모은 정도만큼 커지고 밝아진다 (완충 순간이 눈에 띄게)
    if (chargeRingRef.current) {
      const cr = chargeRingRef.current;
      const on = charge.current > 0.05;
      cr.visible = on;
      if (on) {
        cr.position.set(p.position.x, 0.06, p.position.z);
        const sc = 0.9 + charge.current * 1.5;
        cr.scale.setScalar(sc);
        const mat = cr.material as THREE.MeshBasicMaterial;
        // 완충(1.0)에 닿으면 맥동해 '지금 놓으면 최대'임을 알린다
        mat.opacity = charge.current >= 1 ? 0.7 + Math.sin(t * 14) * 0.3 : 0.35 + charge.current * 0.45;
      }
    }

    // ── 카메라 추적 (미니게임 중에는 미니게임이 카메라를 잡는다)
    // **카메라는 흔들지 않는다** (2026-07-27). 타격의 무게는 히트스톱과 임팩트 파문이
    // 맡는다 — 자동 발사로 명중이 끊이지 않는 게임에서 시점을 흔들면 타격감이 아니라
    // 멀미가 된다. 여기서 하는 일은 주인공을 부드럽게 따라가는 것뿐.
    if (!hiddenRef.current) {
      const cam = state.camera;
      const k = 1 - Math.pow(0.001, dt);
      cam.position.lerp(new THREE.Vector3(p.position.x, 15.5, p.position.z + 9.5), k);
      cam.lookAt(p.position.x, 0, p.position.z);
    }

    // ── 미니맵 갱신 (0.12s 간격) — 플레이어 위치·탐사 반경·마커 상태
    const mch = minimapRef?.current;
    if (mch && mch.seen) {
      minimapTick.current -= dt;
      if (minimapTick.current <= 0) {
        minimapTick.current = 0.12;
        const cx = (p.position.x - CELL / 2) / CELL + GRID / 2;
        const cy = (p.position.z - CELL / 2) / CELL + GRID / 2;
        mch.px = cx;
        mch.py = cy;
        const R = 5; // 탐사 반경 (셀) — 걸어가며 지도가 밝혀진다
        const icx = Math.round(cx);
        const icy = Math.round(cy);
        for (let oy = -R; oy <= R; oy++) {
          for (let ox = -R; ox <= R; ox++) {
            if (ox * ox + oy * oy > R * R + 2) continue;
            const nx = icx + ox;
            const ny = icy + oy;
            if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) mch.seen[ny * GRID + nx] = 1;
          }
        }
        mch.chestX = chestState.current === 'idle' && floor.chest ? floor.chest.x : -1;
        mch.homeX = homeState.current !== 'used' && floor.homeDoor ? floor.homeDoor.x : -1;
        mch.bossAlive = !bossDead.current;
        // 역류 중에는 출구 주변을 밝혀 준다 — 무너지는 소리가 출구 쪽에서 들리기 때문.
        // (제한 시간 안에 '아직 못 본 출구'를 찾으라는 건 선택이 아니라 운이 된다)
        if (rushRef.current) {
          for (let oy = -2; oy <= 2; oy++)
            for (let ox = -2; ox <= 2; ox++) {
              const nx = floor.exit.x + ox;
              const ny = floor.exit.y + oy;
              if (nx >= 0 && ny >= 0 && nx < GRID && ny < GRID) mch.seen[ny * GRID + nx] = 1;
            }
        }
      }
    }
  });

  return (
    <group visible={!hidden}>
      {/* 비네트·블룸(포스트프로세싱) 도입에 맞춰 기본광을 살짝 보강 (가독성 유지) */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 14, 4]} intensity={1.15} />

      {/* 바닥 (교대 색 × 절차 돌결 텍스처 — 회색조 결에 인스턴스 색이 곱해진다)
          ⚡가벼움 모드는 텍스처·범프 없는 플랫 재질 — key로 재질을 통째로 갈아 끼운다 */}
      <instancedMesh ref={floorMeshRef} args={[undefined, undefined, floorCells.length]} frustumCulled={false}>
        <boxGeometry args={[CELL, 0.3, CELL]} />
        {lite ? (
          <meshStandardMaterial key="lite" />
        ) : (
          <meshStandardMaterial key="high" map={getFloorTexture()} bumpMap={getFloorTexture()} bumpScale={0.5} />
        )}
      </instancedMesh>

      {/* 벽 — 10층 단위 테마 색 × 절차 층리 텍스처 */}
      <instancedMesh ref={wallMeshRef} args={[undefined, undefined, wallCells.length]} frustumCulled={false}>
        <boxGeometry args={[CELL, 2.6, CELL]} />
        {lite ? (
          <meshStandardMaterial key="lite" color={theme.wall} />
        ) : (
          <meshStandardMaterial
            key="high"
            color={theme.wall}
            map={getWallTexture()}
            bumpMap={getWallTexture()}
            bumpScale={0.4}
          />
        )}
      </instancedMesh>

      {/* 적 — 타입마다 실루엣이 다르고(기능이 보이게), 5층 단위 티어가 몸통·색을 바꾼다.
          한 메시로 전부 그리면 네 타입이 색만 다른 같은 덩어리로 보여 긴장이 안 생긴다. */}
      {(['chaser', 'shooter', 'dasher', 'tank', 'elite'] as EnemyKind[]).map((k) => (
        <instancedMesh
          key={`${k}:${enemyTier}`}
          ref={(m) => (enemyKindRefs.current[k] = m)}
          args={[enemyGeoms[k], undefined, Math.max(1, enemies.current.length)]}
          frustumCulled={false}
        >
          <meshStandardMaterial emissive={ENEMY_TIER_EMISSIVE[enemyTier]} emissiveIntensity={0.6} />
        </instancedMesh>
      ))}

      {/* 투사체 (공격력에 따라 크기·색 변화) */}
      <instancedMesh ref={shotMeshRef} args={[undefined, undefined, MAX_SHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 10, 10]} />
        <meshStandardMaterial emissive="#ffb020" emissiveIntensity={1.6} />
      </instancedMesh>

      {/* 차지 링 — 모으는 동안 발밑에서 자라 완충에 가까울수록 밝아진다 (시각 전용) */}
      <mesh ref={chargeRingRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.5, 0.72, 28]} />
        <meshBasicMaterial color="#8de0ff" transparent opacity={0.8} toneMapped={false} depthWrite={false} />
      </mesh>

      {/* 임팩트 파문 — 카메라를 흔드는 대신 맞은 자리에 새기는 충격 링.
          바닥에 눕힌 얇은 링을 additive로 태워 '빛의 파문'처럼 보이게 한다. */}
      <instancedMesh ref={rippleMeshRef} args={[undefined, undefined, MAX_RIPPLES]} frustumCulled={false}>
        <ringGeometry args={[0.82, 1, 30]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </instancedMesh>

      {/* 파티클 (타격 스파크·처치 폭발·보물 반짝임) — additive로 빛나는 불꽃 */}
      <instancedMesh ref={particleMeshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </instancedMesh>

      {/* 적 발밑 블롭 섀도우 (접지감 — 프레임에서 위치 갱신) */}
      <instancedMesh ref={enemyShadowRef} args={[undefined, undefined, enemies.current.length]} frustumCulled={false}>
        <planeGeometry args={[1.35, 1.35]} />
        <meshBasicMaterial map={getBlobShadowTexture()} transparent depthWrite={false} />
      </instancedMesh>

      {/* 플레이어 (블록 캐릭터 + 파워업 시각화) */}
      <group ref={playerRef} position={[startX, 0, startZ]}>
        <BlobShadow />
        <group ref={bodyRef}>
          <Hero variant={heroVariant} />
        </group>
        {/* 멀티샷 궤도 구슬 */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} ref={(m) => (orbs.current[i] = m)} scale={0.0001}>
            <sphereGeometry args={[0.11, 8, 8]} />
            <meshStandardMaterial color="#ffd166" emissive="#ffb020" emissiveIntensity={1.4} />
          </mesh>
        ))}
        {/* 보물 획득 황금 잔광 */}
        <pointLight ref={glowRef} color="#ffcf5c" intensity={0} distance={7} position={[0, 1.2, 0]} />
        {/* 진화 「합본」 보유 표시 — 발밑에 회전하는 금빛 룬 링 (조합됨이 상시 보인다) */}
        <mesh ref={evoRingRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
          <ringGeometry args={[0.78, 0.92, 24, 1]} />
          <meshStandardMaterial
            color="#ffd166"
            emissive="#c98f1e"
            emissiveIntensity={1}
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* 보물상자 */}
      {chestPos && (
        <group ref={chestRef} position={[chestPos[0], 0, chestPos[1]]}>
          <BlobShadow size={1.5} y={0.03} />
          <mesh position={[0, 0.3, 0]}>
            <boxGeometry args={[0.95, 0.55, 0.68]} />
            <meshStandardMaterial color="#8a5a2b" />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <boxGeometry args={[0.99, 0.18, 0.72]} />
            <meshStandardMaterial color="#a06a33" />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <boxGeometry args={[1.01, 0.12, 0.74]} />
            <meshStandardMaterial color="#ffd166" emissive="#c98f1e" emissiveIntensity={0.7} />
          </mesh>
          <pointLight color="#ffd166" intensity={1.1} distance={5} position={[0, 1, 0]} />
        </group>
      )}

      {/* 마을로 가는 문 (5층마다) */}
      {homePos && (
        <group ref={homeDoorRef} position={[homePos[0], 0, homePos[1]]}>
          <mesh position={[0, 1.05, 0]}>
            <boxGeometry args={[1.3, 2.1, 0.22]} />
            <meshStandardMaterial color="#c98f4a" />
          </mesh>
          <mesh position={[0, 2.24, 0]}>
            <boxGeometry args={[1.55, 0.26, 0.32]} />
            <meshStandardMaterial color="#8a5a2b" />
          </mesh>
          <mesh position={[0.42, 1.0, 0.14]}>
            <sphereGeometry args={[0.09, 8, 8]} />
            <meshStandardMaterial color="#ffd166" emissive="#c98f1e" emissiveIntensity={1.2} />
          </mesh>
          <pointLight color="#ffcf8a" intensity={1.5} distance={6} position={[0, 1.6, 0.7]} />
        </group>
      )}

      {/* 낡은 제단 — 「피를 잉크로.」 HP를 바치면 보물 */}
      {altarPos && (
        <group ref={altarRef} position={[altarPos[0], 0, altarPos[1]]}>
          <BlobShadow size={1.8} y={0.03} />
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.55, 0.7, 0.6, 6]} />
            <meshStandardMaterial color="#3a3344" />
          </mesh>
          <mesh position={[0, 0.85, 0]}>
            <octahedronGeometry args={[0.28]} />
            <meshStandardMaterial color="#ff4d6e" emissive="#a01030" emissiveIntensity={1.3} />
          </mesh>
          <pointLight color="#ff5d7e" intensity={1.2} distance={5} position={[0, 1.2, 0]} />
        </group>
      )}

      {/* 무너지는 서가 — 위태롭게 기울어진 책장, 틈새로 금박 표지가 반짝인다 */}
      {collapsePos && (
        <group ref={collapseRef} position={[collapsePos[0], 0, collapsePos[1]]} rotation={[0, 0.3, 0.09]}>
          <BlobShadow size={2.0} y={0.03} />
          {/* 책장 몸통 */}
          <mesh position={[0, 1.05, 0]}>
            <boxGeometry args={[1.5, 2.1, 0.45]} />
            <meshStandardMaterial color="#4a3524" />
          </mesh>
          {/* 선반 세 칸에 꽂힌 책들 (색만 바꾼 얇은 판 — 절차 생성) */}
          {[0.45, 1.05, 1.65].map((y, si) => (
            <mesh key={si} position={[0, y, 0.12]}>
              <boxGeometry args={[1.3, 0.34, 0.3]} />
              <meshStandardMaterial color={['#7a2f3a', '#2f4a5a', '#5a4a2f'][si]} />
            </mesh>
          ))}
          {/* 금박 표지 — 흔들면 쏟아질 보물 */}
          <mesh position={[0.35, 1.05, 0.3]}>
            <boxGeometry args={[0.22, 0.32, 0.1]} />
            <meshStandardMaterial color="#ffd166" emissive="#a07510" emissiveIntensity={1.2} />
          </mesh>
          <pointLight color="#ffd166" intensity={1.0} distance={4.5} position={[0.35, 1.2, 0.6]} />
        </group>
      )}

      {/* 찢어진 페이지 — 층을 건너뛰는 비밀 문 (공중에 팔랑이는 종잇조각) */}
      {secretPos && (
        <group ref={secretRef} position={[secretPos[0], 1.05, secretPos[1]]}>
          <mesh rotation={[0, 0.35, 0.06]}>
            <planeGeometry args={[0.85, 1.5]} />
            <meshStandardMaterial
              color="#f4efe0"
              emissive="#8d86a8"
              emissiveIntensity={0.35}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh position={[0.1, -0.05, -0.04]} rotation={[0, -0.3, -0.1]}>
            <planeGeometry args={[0.7, 1.3]} />
            <meshStandardMaterial
              color="#d9d2c0"
              emissive="#6a638a"
              emissiveIntensity={0.3}
              side={THREE.DoubleSide}
            />
          </mesh>
          <pointLight color="#cfd8ff" intensity={1.1} distance={5} position={[0, 0.4, 0.4]} />
        </group>
      )}

      {/* 두 갈래 틈 — 층 안 순간이동 지름길 (한 쌍, 왕복 무제한) */}
      {riftPos &&
        riftPos.map((rp, i) => (
          <group key={i} ref={(g) => (riftRefs.current[i] = g)} position={[rp[0], 1.0, rp[1]]}>
            {/* 새까만 균열 + 옅은 잉크빛 테두리 */}
            <mesh>
              <planeGeometry args={[0.32, 1.7]} />
              <meshBasicMaterial color="#0d0918" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 0, -0.012]}>
              <planeGeometry args={[0.5, 1.88]} />
              <meshStandardMaterial
                color="#b9a3ff"
                emissive="#8d86a8"
                emissiveIntensity={0.55}
                transparent
                opacity={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>
            <pointLight color="#b9a3ff" intensity={0.8} distance={4} />
          </group>
        ))}

      {/* 몬스터 하우스 코인 무더기 (몸으로 줍기) */}
      {orbPos.map((op, i) => (
        <group key={i} ref={(g) => (orbRefs.current[i] = g)} position={[op[0], 0.5, op[1]]}>
          <mesh>
            <octahedronGeometry args={[0.3]} />
            <meshStandardMaterial color="#ffd166" emissive="#c98f1e" emissiveIntensity={1.1} />
          </mesh>
        </group>
      ))}

      {/* 보스 — 페이지의 수호자 (10층마다, 출구를 지킨다) */}
      {isBossFloor && (
        <>
          <mesh ref={bossMeshRef} position={[exitX, 1.35, exitZ]}>
            <dodecahedronGeometry args={[1.5]} />
            <meshStandardMaterial ref={bossMatRef} emissive="#3c1060" emissiveIntensity={0.8} />
          </mesh>
          <mesh ref={bossShadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[exitX, 0.02, exitZ]}>
            <planeGeometry args={[3.6, 3.6]} />
            <meshBasicMaterial map={getBlobShadowTexture()} transparent depthWrite={false} />
          </mesh>
        </>
      )}

      {/* 보스 탄막 */}
      <instancedMesh ref={eshotMeshRef} args={[undefined, undefined, MAX_ESHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshStandardMaterial color="#ff3d5e" emissive="#a01030" emissiveIntensity={1.4} />
      </instancedMesh>

      {/* 출구 수문장 광원 (정예 발치의 붉은 빛 — 프레임에서 위치·세기 갱신) */}
      <pointLight ref={eliteLightRef} color="#ff5030" intensity={0} distance={9} visible={false} />

      {/* 소녀의 흔적 — 은은히 빛나는 꽃 한 송이 */}
      {tracePos && (
        <group ref={traceRef} position={[tracePos[0], 0, tracePos[1]]}>
          <mesh position={[0, 0.35, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.7, 6]} />
            <meshStandardMaterial color="#4f8a4a" />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.18, 10, 10]} />
            <meshStandardMaterial color="#ffb3d1" emissive="#c95a86" emissiveIntensity={0.8} />
          </mesh>
          <pointLight color="#ffb3d1" intensity={0.9} distance={4} position={[0, 1, 0]} />
        </group>
      )}

      {/* 56층의 소녀 '여백' — 찻자리와 촛불 */}
      {girlPos && (
        <group ref={girlRef} position={[girlPos[0], 0, girlPos[1]]}>
          <BlobShadow size={1.3} y={0.03} />
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.5, 0.55, 0.34]} />
            <meshStandardMaterial color="#ff9ec4" />
          </mesh>
          <mesh position={[0, 0.95, 0]}>
            <boxGeometry args={[0.42, 0.4, 0.4]} />
            <meshStandardMaterial color="#ffe0c2" />
          </mesh>
          {/* 팔 */}
          <mesh position={[-0.32, 0.55, 0]}>
            <boxGeometry args={[0.12, 0.36, 0.14]} />
            <meshStandardMaterial color="#ff9ec4" />
          </mesh>
          <mesh position={[0.32, 0.55, 0]}>
            <boxGeometry args={[0.12, 0.36, 0.14]} />
            <meshStandardMaterial color="#ff9ec4" />
          </mesh>
          {/* 긴 머리 — 색이 덜 칠해진 듯한 옅은 빛깔 ('쓰다 만' 등장인물) */}
          <mesh position={[0, 1.17, -0.02]}>
            <boxGeometry args={[0.46, 0.12, 0.44]} />
            <meshStandardMaterial color="#ded4c2" />
          </mesh>
          <mesh position={[0, 0.82, -0.24]}>
            <boxGeometry args={[0.44, 0.82, 0.1]} />
            <meshStandardMaterial color="#ded4c2" />
          </mesh>
          <mesh position={[-0.24, 1.0, 0]}>
            <boxGeometry args={[0.05, 0.34, 0.42]} />
            <meshStandardMaterial color="#ded4c2" />
          </mesh>
          <mesh position={[0.24, 1.0, 0]}>
            <boxGeometry args={[0.05, 0.34, 0.42]} />
            <meshStandardMaterial color="#ded4c2" />
          </mesh>
          <mesh position={[-0.09, 0.98, 0.21]}>
            <boxGeometry args={[0.06, 0.08, 0.02]} />
            <meshStandardMaterial color="#2a2333" />
          </mesh>
          <mesh position={[0.09, 0.98, 0.21]}>
            <boxGeometry args={[0.06, 0.08, 0.02]} />
            <meshStandardMaterial color="#2a2333" />
          </mesh>
          {/* 찻상 + 촛불빛 */}
          <mesh position={[0.95, 0.22, 0]}>
            <cylinderGeometry args={[0.42, 0.48, 0.44, 10]} />
            <meshStandardMaterial color="#8a5a2b" />
          </mesh>
          <mesh position={[0.95, 0.5, 0]}>
            <cylinderGeometry args={[0.09, 0.11, 0.14, 8]} />
            <meshStandardMaterial color="#f4e8d2" />
          </mesh>
          <pointLight color="#ffd9a8" intensity={1.4} distance={6} position={[0.5, 1.3, 0.4]} />
        </group>
      )}

      {/* 나침반 화살표 — 포털(보라)·상자(금)·마을 문(주황)·소녀(분홍) */}
      <group ref={portalArrowRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.16, 0.5, 6]} />
          <meshStandardMaterial color="#9a6bff" emissive="#7a4dff" emissiveIntensity={1.2} transparent opacity={0.85} />
        </mesh>
      </group>
      <group ref={chestArrowRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.14, 0.44, 6]} />
          <meshStandardMaterial color="#ffd166" emissive="#c98f1e" emissiveIntensity={1.1} transparent opacity={0.85} />
        </mesh>
      </group>
      <group ref={homeArrowRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.14, 0.44, 6]} />
          <meshStandardMaterial color="#ffcf8a" emissive="#a06a33" emissiveIntensity={1.0} transparent opacity={0.85} />
        </mesh>
      </group>
      <group ref={girlArrowRef} visible={false}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.14, 0.44, 6]} />
          <meshStandardMaterial color="#ff9ec4" emissive="#c95a86" emissiveIntensity={1.0} transparent opacity={0.85} />
        </mesh>
      </group>

      {/* 데미지 숫자 스프라이트 */}
      {dmgTextures.map((tex, i) => (
        <sprite
          key={i}
          ref={(s) => (dmgSprites.current[i] = s)}
          visible={false}
          scale={[1.0, 0.5, 1]}
        >
          <spriteMaterial map={tex} transparent depthWrite={false} />
        </sprite>
      ))}

      {/* 출구 — 보통 층은 포털, 100층은 집으로 가는 황금 문 */}
      <group ref={portalRef} position={[exitX, 1.1, exitZ]}>
        {floorNo >= 100 ? (
          <>
            <mesh position={[0, 0.7, 0]}>
              <boxGeometry args={[1.7, 3.4, 0.26]} />
              <meshStandardMaterial color="#ffd166" emissive="#c98f1e" emissiveIntensity={0.9} />
            </mesh>
            <mesh position={[0, 2.5, 0]}>
              <boxGeometry args={[2.1, 0.3, 0.4]} />
              <meshStandardMaterial color="#a8781f" />
            </mesh>
            <pointLight color="#ffe9a0" intensity={3} distance={11} />
          </>
        ) : (
          <>
            <mesh>
              <torusGeometry args={[0.85, 0.14, 12, 40]} />
              <meshStandardMaterial color="#8f6bff" emissive="#7a4dff" emissiveIntensity={1.4} />
            </mesh>
            <pointLight color="#9a6bff" intensity={2.4} distance={9} />
          </>
        )}
      </group>

      {/* 🔥 모험의 길 — 출구 곁의 붉은 포털. 여기로 들어가면 다음 층이 사나워지는 대신
          그 층을 뚫은 보상은 전부 레어 이상. 확인 화면 없이 몸으로 고른다. */}
      {forkPos && (
        <>
          <group ref={forkRef} position={[forkPos[0], 1.1, forkPos[1]]}>
            <mesh>
              <torusGeometry args={[0.85, 0.16, 12, 40]} />
              <meshStandardMaterial color="#ff6a4d" emissive="#ff2d1e" emissiveIntensity={1.8} />
            </mesh>
            {/* 안쪽에서 일렁이는 불씨 — 보라 포털과 실루엣이 헷갈리지 않게 심지를 하나 더 */}
            <mesh scale={0.42}>
              <octahedronGeometry args={[0.9, 0]} />
              <meshStandardMaterial color="#ffb08a" emissive="#ff5136" emissiveIntensity={2.2} />
            </mesh>
            <pointLight color="#ff6a4d" intensity={2.8} distance={10} />
          </group>
          {/* 발밑 경고 링 — "여기는 다른 길"이라고 바닥에 미리 적어 둔다 */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[forkPos[0], 0.05, forkPos[1]]}>
            <ringGeometry args={[1.15, 1.5, 30]} />
            <meshBasicMaterial
              color="#ff5136"
              transparent
              opacity={0.42}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── 가상 조이스틱 DOM — 모듈 싱글턴 (던전이 숨겨진 채 아레나 훅과 공존해도 1개만) ──
const STICK_R = 56; // 스틱 최대 반경(px) — 기울기 정규화(len/R)와 일치
let vstick: { base: HTMLDivElement; knob: HTMLDivElement; refs: number } | null = null;
function acquireVstick() {
  if (!vstick) {
    const base = document.createElement('div');
    base.className = 'vstick';
    const knob = document.createElement('div');
    knob.className = 'vstick-knob';
    base.appendChild(knob);
    document.body.appendChild(base);
    vstick = { base, knob, refs: 0 };
  }
  vstick.refs++;
  return vstick;
}
function releaseVstick() {
  if (!vstick) return;
  vstick.refs--;
  if (vstick.refs <= 0) {
    vstick.base.remove();
    vstick = null;
  }
}

// 키보드(WASD/방향키) + 터치 드래그(가상 조이스틱) 입력 → 정규화된 이동 벡터
// e.code 기반이라 한/영 입력 상태와 무관. Shift 조합(디버그 키 등)은 무시.
// 터치·펜 드래그에는 조이스틱 시각화가 손가락 위치에 뜨고, 반경 밖으로 끌면
// 베이스가 따라와(플로팅 스틱) 방향 전환이 쉽다. pausedRef가 true면 표시 안 함
// (미니게임 중 숨겨진 던전 씬이 스틱을 띄우는 것 방지).
// 몬스터 아레나(GemArenaScene)·마을(TownScene)에서도 재사용한다.
// ── 차지 샷 입력 (2026-07-25)
// 자동 조준은 그대로 두고 '누르고 있는 동안 모아서 한 방'을 얹는다 — 자동 발사는 계속
// 돌아가므로 이 조작을 몰라도 예전처럼 플레이할 수 있다(접근성 유지).
// 데스크톱은 Space, 모바일은 화면의 ⚡ 버튼(엄지 반대편) — 이동 스틱과 동시에 눌린다.
export function useChargeInput(pausedRef?: React.MutableRefObject<boolean>) {
  const held = useRef(false);
  useEffect(() => {
    const btn = document.createElement('button');
    btn.className = 'charge-btn';
    btn.type = 'button';
    btn.textContent = '⚡';
    document.body.appendChild(btn);
    const down = () => {
      if (!pausedRef?.current) held.current = true;
    };
    const up = () => {
      held.current = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        down();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') up();
    };
    // 오버레이·미니게임 중에는 버튼을 감춘다 (선택 화면 위에 떠 있으면 오조작·시야 방해)
    const vis = setInterval(() => {
      const hide = !!pausedRef?.current;
      btn.style.display = hide ? 'none' : '';
      if (hide) held.current = false;
    }, 150);
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', up);
    return () => {
      clearInterval(vis);
      btn.remove();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', up);
    };
  }, [pausedRef]);
  return held;
}

// ── 찰나(시간 동결) 입력 (2026-07-27) — 처치 게이지가 가득 차면(ui.ready) 탭/F키로 1회 발동.
// 버튼 자체가 진행도를 보여준다(n/FREEZE_KILLS) — 차지 링처럼 전투 중 발밑을 못 보는 문제를
// 피하려고 텍스트를 버튼에 직접 새겼다. ui는 DungeonScene useFrame이 매 처치마다 갱신하는 ref.
export function useFreezeInput(
  pausedRef: React.MutableRefObject<boolean> | undefined,
  ui: React.MutableRefObject<{ n: number; ready: boolean }>,
) {
  const pressed = useRef(false);
  useEffect(() => {
    const btn = document.createElement('button');
    btn.className = 'freeze-btn';
    btn.type = 'button';
    document.body.appendChild(btn);
    const trigger = () => {
      if (!pausedRef?.current && ui.current.ready) pressed.current = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyF' && !e.repeat) trigger();
    };
    // 150ms 간격으로 문구·상태만 갱신 (허밍처럼 매 프레임 필요한 소리가 아니라 가벼운 폴링으로 충분)
    const vis = setInterval(() => {
      const hide = !!pausedRef?.current;
      btn.style.display = hide ? 'none' : '';
      btn.textContent = ui.current.ready ? '❄️' : `❄️ ${ui.current.n}/${FREEZE_KILLS}`;
      btn.classList.toggle('ready', ui.current.ready);
    }, 150);
    btn.addEventListener('pointerdown', trigger);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(vis);
      btn.remove();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pausedRef, ui]);
  return pressed;
}

// ── 결의(무적 대시) 입력 (2026-07-29) — 찰나와 대칭인 두 번째 처치 게이지 입력. 별개의
// DOM 버튼·키(R)로 완전히 분리해 두 자원을 헷갈리지 않게 한다(찰나=F, 결의=R).
export function useResolveInput(
  pausedRef: React.MutableRefObject<boolean> | undefined,
  ui: React.MutableRefObject<{ n: number; ready: boolean }>,
) {
  const pressed = useRef(false);
  useEffect(() => {
    const btn = document.createElement('button');
    btn.className = 'resolve-btn';
    btn.type = 'button';
    document.body.appendChild(btn);
    const trigger = () => {
      if (!pausedRef?.current && ui.current.ready) pressed.current = true;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && !e.repeat) trigger();
    };
    const vis = setInterval(() => {
      const hide = !!pausedRef?.current;
      btn.style.display = hide ? 'none' : '';
      btn.textContent = ui.current.ready ? '💨' : `💨 ${ui.current.n}/${RESOLVE_KILLS}`;
      btn.classList.toggle('ready', ui.current.ready);
    }, 150);
    btn.addEventListener('pointerdown', trigger);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearInterval(vis);
      btn.remove();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pausedRef, ui]);
  return pressed;
}

export function useMoveInput(pausedRef?: React.MutableRefObject<boolean>) {
  const dir = useRef({ x: 0, z: 0 });
  useEffect(() => {
    const keys = new Set<string>();
    const drag = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
    const stick = acquireVstick();

    const update = () => {
      let x = 0;
      let z = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) z -= 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) z += 1;
      if (drag.active) {
        let dx = drag.x - drag.ox;
        let dy = drag.y - drag.oy;
        // 강제 가로 회전 중이면 손가락 벡터(뷰포트 기준)를 화면에 보이는 축으로 변환
        const rot = appRotation();
        if (rot === 90) {
          const t = dx;
          dx = dy;
          dy = -t;
        } else if (rot === -90) {
          const t = dx;
          dx = -dy;
          dy = t;
        }
        const len = Math.hypot(dx, dy);
        if (len > 10) {
          const m = Math.min(1, len / STICK_R);
          x = (dx / len) * m;
          z = (dy / len) * m;
        }
      }
      const mag = Math.hypot(x, z);
      if (mag > 1) {
        x /= mag;
        z /= mag;
      }
      dir.current = { x, z };
    };

    const drawStick = () => {
      stick.base.style.left = `${drag.ox}px`;
      stick.base.style.top = `${drag.oy}px`;
      stick.knob.style.transform = `translate(${drag.x - drag.ox}px, ${drag.y - drag.oy}px)`;
    };

    const down = (e: KeyboardEvent) => {
      if (e.shiftKey) return; // Shift+D(디버그) 등과 충돌 방지
      keys.add(e.code);
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      update();
    };
    const pdown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      // 버튼·메뉴 오버레이 위에서는 스틱을 시작하지 않는다 — 게임 화면(캔버스) 위에서만
      const t = e.target as HTMLElement;
      if (t.closest('button') || !t.closest('canvas')) return;
      drag.active = true;
      drag.ox = e.clientX;
      drag.oy = e.clientY;
      drag.x = e.clientX;
      drag.y = e.clientY;
      // 마우스는 키보드 병행 조작이라 시각화 없이 예전처럼 동작
      if (e.pointerType !== 'mouse' && !pausedRef?.current) {
        drawStick();
        stick.base.classList.add('on');
      }
      update();
    };
    const pmove = (e: PointerEvent) => {
      if (!e.isPrimary || !drag.active) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      const dx = drag.x - drag.ox;
      const dy = drag.y - drag.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        // 끝까지 기울인 채 계속 끌면 베이스가 손가락을 따라온다 (방향 전환이 쉬움)
        drag.ox = drag.x - (dx / len) * STICK_R;
        drag.oy = drag.y - (dy / len) * STICK_R;
      }
      drawStick();
      update();
    };
    const pup = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      drag.active = false;
      stick.base.classList.remove('on');
      update();
    };
    const blur = () => {
      keys.clear();
      drag.active = false;
      stick.base.classList.remove('on');
      update();
    };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointerdown', pdown);
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', pup);
    window.addEventListener('pointercancel', pup);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointerdown', pdown);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
      window.removeEventListener('pointercancel', pup);
      window.removeEventListener('blur', blur);
      releaseVstick();
    };
  }, [pausedRef]);
  return dir;
}

export default memo(DungeonScene);
