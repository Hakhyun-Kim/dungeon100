import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Hero from './Hero';
import { useMoveInput } from './DungeonScene';
import { makeTextTexture } from './textTexture';
import { mulberry32 } from '../lib/rng';

// 걸어다니는 3D 마을 — 옛날 RPG처럼 주인공이 광장을 돌아다니며 NPC에게 다가가 대화하고,
// 던전 입구 아치로 걸어가면 내려간다. 던전과 동일한 useMoveInput·Hero·카메라 재사용.
export type TownTarget = 'chief' | 'nina' | 'muk' | 'entrance' | null;

const TR = 11; // 광장 반경(정사각형 절반)
const HERO_START: [number, number] = [0, 8];

interface Npc {
  id: 'chief' | 'nina' | 'muk';
  name: string;
  x: number;
  z: number;
  body: string;
  head: string;
}
const NPCS: Npc[] = [
  { id: 'chief', name: '촌장', x: -3.2, z: 4, body: '#b9a3e0', head: '#e8d9b0' },
  { id: 'nina', name: '니나', x: 6, z: 2.6, body: '#ff9ec4', head: '#ffe0c2' },
  { id: 'muk', name: '무크', x: -6.6, z: -2.4, body: '#c98a4a', head: '#e8c9a0' },
];

interface Building {
  cx: number;
  cz: number;
  w: number;
  d: number;
  h: number;
  wall: string;
  roof: string;
}
const BUILDINGS: Building[] = [
  { cx: -3.2, cz: 6.7, w: 3.4, d: 2.6, h: 2.4, wall: '#5b4a86', roof: '#3c2f66' }, // 촌장 집
  { cx: 8.6, cz: 2.6, w: 3.2, d: 3.2, h: 2.9, wall: '#7a5a86', roof: '#a86a4a' }, // 여관
  { cx: -8.8, cz: -2.4, w: 3.0, d: 3.0, h: 2.6, wall: '#55474a', roof: '#3a2a2a' }, // 대장간
];

const ENTRANCE: [number, number] = [3.6, -8.6];
const NEAR_R = 2.3; // 상호작용 감지 반경
const TREES: [number, number][] = [
  [-10, 8],
  [10, 8],
  [-10.2, -8.5],
  [9.5, -6],
  [1.5, 9.5],
];

// ── 시간의 흐름 — 5층마다 마을이 달라진다.
// 20층 단위 '시절'(계절·조명·몬스터 습격 피해)이 크게 바뀌고, 같은 시절 안에서도
// 방문(5층)마다 시드가 바뀌어 나무·잔해·부서진 담장이 재배치된다.
// 세계관: 주인공이 깊이 내려갈수록(=마지막 장이 쓰일수록) 서문의 마을에도 시간이 흐른다.
// 기능 앵커(건물·NPC·우물·입구 위치, 충돌)는 고정 — 바뀌는 건 풍경뿐.
export const villageStage = (floorNo: number) =>
  Math.min(4, Math.floor(Math.max(0, floorNo) / 20));
export const VILLAGE_STAGE_NAMES = [
  '🏘️ 마을 — 고요한 밤',
  '🍂 마을 — 가을바람',
  '❄️ 마을 — 습격의 흔적',
  '🔥 마을 — 방벽의 시간',
  '🌅 마을 — 폐허와 새벽',
];
// Canvas 배경·안개색 (App에서 village phase일 때 적용)
export const VILLAGE_STAGE_BG = ['#140e22', '#1d1226', '#0e1424', '#170d1c', '#2b1a26'];

interface StageCfg {
  ambient: number;
  dirPos: [number, number, number];
  dirInt: number;
  dirColor: string;
  hemiSky: string;
  hemiGround: string;
  hemiInt: number;
  groundA: string;
  groundB: string;
  fence: string;
  leafColors: string[];
  bare: boolean; // 잎이 진 나무 (가지만)
  windowsLit: [boolean, boolean, boolean]; // 촌장집·여관·대장간 (꺼진 창은 판자로 막힘)
  brokenFence: number; // 담장 조각이 부서져 사라질 확률
  leafPatches: number;
  scorches: number;
  rubbles: number;
  crates: number;
  spikes: number; // X자 통나무 방벽
  flowers: number;
  campfire: boolean;
  torch: boolean;
  roofTilt: number; // 지붕 기울기 최대치
  ruinChunk: boolean; // 여관 모서리 붕괴 (폐허)
}

const STAGES: StageCfg[] = [
  {
    // 0 — 고요한 밤 (1~19층): 처음 도착한 그 마을
    ambient: 0.72, dirPos: [8, 16, 6], dirInt: 1.0, dirColor: '#ffffff',
    hemiSky: '#b9c8ff', hemiGround: '#3a2f55', hemiInt: 0.5,
    groundA: '#4a4066', groundB: '#544a72', fence: '#3a3055',
    leafColors: ['#4f8a4a', '#5a9a52', '#3f7a42'], bare: false,
    windowsLit: [true, true, true], brokenFence: 0,
    leafPatches: 0, scorches: 0, rubbles: 0, crates: 0, spikes: 0, flowers: 0,
    campfire: false, torch: false, roofTilt: 0, ruinChunk: false,
  },
  {
    // 1 — 가을바람 (20~39층): 노을빛, 단풍과 낙엽. 습격 소문에 궤짝이 쌓이기 시작
    ambient: 0.66, dirPos: [10, 13, 4], dirInt: 0.95, dirColor: '#ffdfba',
    hemiSky: '#e8a37a', hemiGround: '#43304e', hemiInt: 0.55,
    groundA: '#514060', groundB: '#5c4a68', fence: '#443a58',
    leafColors: ['#c97f3f', '#d99a44', '#a8562f'], bare: false,
    windowsLit: [true, true, true], brokenFence: 0.1,
    leafPatches: 8, scorches: 0, rubbles: 0, crates: 2, spikes: 0, flowers: 0,
    campfire: false, torch: false, roofTilt: 0, ruinChunk: false,
  },
  {
    // 2 — 습격의 흔적 (40~59층): 차가운 밤. 잎 진 나무, 그을음, 무너진 담장, 판자로 막은 창
    ambient: 0.5, dirPos: [6, 15, 8], dirInt: 0.72, dirColor: '#c2d2ff',
    hemiSky: '#8298d8', hemiGround: '#2a2340', hemiInt: 0.5,
    groundA: '#3c3554', groundB: '#453d5e', fence: '#332c48',
    leafColors: ['#6a5a3f'], bare: true,
    windowsLit: [true, false, true], brokenFence: 0.28,
    leafPatches: 0, scorches: 4, rubbles: 3, crates: 3, spikes: 0, flowers: 0,
    campfire: false, torch: true, roofTilt: 0, ruinChunk: false,
  },
  {
    // 3 — 방벽의 시간 (60~79층): 마을이 요새가 된다. 통나무 방벽, 모닥불, 꺼져 가는 창
    ambient: 0.45, dirPos: [5, 14, 7], dirInt: 0.6, dirColor: '#ffcaa0',
    hemiSky: '#8a5a66', hemiGround: '#221c33', hemiInt: 0.52,
    groundA: '#372f4c', groundB: '#3f3756', fence: '#2d2740',
    leafColors: ['#544732'], bare: true,
    windowsLit: [true, false, false], brokenFence: 0.42,
    leafPatches: 0, scorches: 7, rubbles: 6, crates: 4, spikes: 6, flowers: 0,
    campfire: true, torch: true, roofTilt: 0.1, ruinChunk: false,
  },
  {
    // 4 — 폐허와 새벽 (80층~): 부서진 마을 너머로 낮게 새벽빛 — 끝이 가깝다는 희망.
    // 대장간 불빛만 남아 있다 (무크는 마지막까지 벼린다). 잔해 틈에 꽃이 핀다.
    ambient: 0.55, dirPos: [-12, 6, -3], dirInt: 1.25, dirColor: '#ffb27a',
    hemiSky: '#ffc9a4', hemiGround: '#3a2c44', hemiInt: 0.7,
    groundA: '#4a3e52', groundB: '#555061', fence: '#3b3348',
    leafColors: ['#5f5140'], bare: true,
    windowsLit: [false, false, true], brokenFence: 0.6,
    leafPatches: 0, scorches: 8, rubbles: 9, crates: 2, spikes: 3, flowers: 7,
    campfire: true, torch: false, roofTilt: 0.18, ruinChunk: true,
  },
];

interface Decor {
  stage: number;
  s: StageCfg;
  trees: { x: number; z: number; lean: number; leaf: string; h: number }[];
  fence: { x: number; z: number; w: number; d: number; tiltX: number; tiltZ: number }[];
  patches: { x: number; z: number; r: number; c: string }[];
  scorches: { x: number; z: number; r: number }[];
  rubbles: { x: number; z: number; s: number; rot: number; c: string }[];
  crates: { x: number; z: number; rot: number }[];
  spikes: { x: number; z: number; rot: number }[];
  flowers: { x: number; z: number; c: string }[];
  roofTilts: number[];
}

function buildDecor(floorNo: number): Decor {
  const stage = villageStage(floorNo);
  const s = STAGES[stage];
  // 5층 단위 시드 — 같은 시절이라도 방문마다 배치가 달라진다
  const r = mulberry32(Math.floor(Math.max(0, floorNo) / 5) * 97 + stage * 7 + 13);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];

  // 우물·입구·건물·NPC·주인공 시작점을 피해서 흩뿌리기 (장식은 충돌 없음 — 겹침만 방지)
  const isFree = (x: number, z: number) => {
    if (Math.hypot(x, z) < 2.0) return false;
    if (Math.hypot(x - ENTRANCE[0], z - ENTRANCE[1]) < 2.6) return false;
    if (Math.hypot(x - HERO_START[0], z - HERO_START[1]) < 1.5) return false;
    for (const b of BUILDINGS) {
      if (
        x > b.cx - b.w / 2 - 0.8 &&
        x < b.cx + b.w / 2 + 0.8 &&
        z > b.cz - b.d / 2 - 0.8 &&
        z < b.cz + b.d / 2 + 0.8
      )
        return false;
    }
    for (const n of NPCS) if (Math.hypot(x - n.x, z - n.z) < 1.4) return false;
    return true;
  };
  const scatter = (count: number, edgeBias = false) => {
    const out: [number, number][] = [];
    let guard = 0;
    while (out.length < count && guard++ < count * 40) {
      const x = (r() * 2 - 1) * (TR - 1.2);
      const z = (r() * 2 - 1) * (TR - 1.2);
      if (edgeBias && Math.max(Math.abs(x), Math.abs(z)) < TR - 3.5) continue;
      if (!isFree(x, z)) continue;
      out.push([x, z]);
    }
    return out;
  };

  const trees = TREES.map(([bx, bz]) => {
    const x = Math.max(-(TR - 0.8), Math.min(TR - 0.8, bx + (r() * 2 - 1) * 1.6));
    const z = Math.max(-(TR - 0.8), Math.min(TR - 0.8, bz + (r() * 2 - 1) * 1.6));
    return {
      x,
      z,
      lean: stage >= 3 ? (r() - 0.5) * 0.35 : (r() - 0.5) * 0.06,
      leaf: pick(s.leafColors),
      h: 0.9 + r() * 0.5,
    };
  });

  // 담장 — 벽마다 8조각. 시절이 험해질수록 조각이 사라지고 기운다
  const fence: Decor['fence'] = [];
  const SEG = 8;
  const len = TR * 2 + 1;
  const segLen = len / SEG;
  for (const wall of [
    { horiz: true, fixed: TR },
    { horiz: true, fixed: -TR },
    { horiz: false, fixed: TR },
    { horiz: false, fixed: -TR },
  ]) {
    for (let k = 0; k < SEG; k++) {
      if (r() < s.brokenFence) continue; // 부서져 사라진 조각
      const off = -len / 2 + segLen * (k + 0.5);
      const tilt = stage >= 2 ? (r() - 0.5) * 0.18 : 0;
      fence.push(
        wall.horiz
          ? { x: off, z: wall.fixed, w: segLen - 0.06, d: 0.4, tiltX: tilt, tiltZ: 0 }
          : { x: wall.fixed, z: off, w: 0.4, d: segLen - 0.06, tiltX: 0, tiltZ: tilt },
      );
    }
  }

  const patches = scatter(s.leafPatches).map(([x, z]) => ({
    x, z, r: 0.45 + r() * 0.5, c: pick(['#c97f3f', '#a8562f', '#d99a44']),
  }));
  const scorches = scatter(s.scorches).map(([x, z]) => ({ x, z, r: 0.5 + r() * 0.7 }));
  const rubbles = scatter(s.rubbles).flatMap(([x, z]) =>
    Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({
      x: x + (r() - 0.5) * 0.9,
      z: z + (r() - 0.5) * 0.9,
      s: 0.18 + r() * 0.3,
      rot: r() * Math.PI,
      c: pick(['#5a5262', '#433b52', '#38304a']),
    })),
  );
  const crates = scatter(s.crates).map(([x, z]) => ({ x, z, rot: r() * Math.PI }));
  const spikes = scatter(s.spikes, true).map(([x, z]) => ({ x, z, rot: r() * Math.PI }));
  const flowers = scatter(s.flowers).map(([x, z]) => ({
    x, z, c: pick(['#ff9ec4', '#ffd0e4', '#fff1b8']),
  }));
  const roofTilts = BUILDINGS.map(() => s.roofTilt * (r() * 2 - 1));

  return { stage, s, trees, fence, patches, scorches, rubbles, crates, spikes, flowers, roofTilts };
}

export default function TownScene({
  pausedRef,
  onNear,
  floorNo = 0,
}: {
  pausedRef: React.MutableRefObject<boolean>;
  onNear: (t: TownTarget) => void;
  floorNo?: number;
}) {
  const input = useMoveInput();
  const heroRef = useRef<THREE.Group>(null);
  const npcRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const entranceRef = useRef<THREE.Group>(null);
  const entranceLightRef = useRef<THREE.PointLight>(null);
  // undefined로 시작 → 마운트 후 첫 프레임에 실제 근접값(보통 null)을 반드시 1회 보고.
  // (상점 등에서 씬이 리마운트될 때 App의 stale한 '무크와 대화' 버튼을 확실히 지운다)
  const lastNear = useRef<TownTarget | undefined>(undefined);

  const decor = useMemo(() => buildDecor(floorNo), [floorNo]);
  const cfg = decor.s;

  // NPC 이름표 + 던전 입구 표지 텍스처
  const labels = useMemo(
    () => ({
      chief: makeTextTexture('👵 촌장', { width: 256, height: 88, color: '#ffe9b3' }),
      nina: makeTextTexture('👧 니나', { width: 256, height: 88, color: '#ffd0e4' }),
      muk: makeTextTexture('🧔 무크', { width: 256, height: 88, color: '#ffd9a8' }),
      door: makeTextTexture('던전 입구', { width: 256, height: 88, color: '#c9b4ff' }),
    }),
    [],
  );
  useEffect(
    () => () => Object.values(labels).forEach((t) => t.dispose()),
    [labels],
  );
  const labelByNpc = (id: Npc['id']) => labels[id];

  // 광장 경계 + 건물 충돌 (히어로 반경 고려)
  const canWalk = (x: number, z: number) => {
    if (x < -TR + 0.5 || x > TR - 0.5 || z < -TR + 0.5 || z > TR - 0.5) return false;
    for (const b of BUILDINGS) {
      if (
        x > b.cx - b.w / 2 - 0.5 &&
        x < b.cx + b.w / 2 + 0.5 &&
        z > b.cz - b.d / 2 - 0.5 &&
        z < b.cz + b.d / 2 + 0.5
      ) {
        return false;
      }
    }
    return true;
  };

  // 개발 검증용 훅 (프로덕션 제외)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__d100town = {
      place: (x: number, z: number) => {
        const h = heroRef.current;
        if (h) {
          h.position.x = x;
          h.position.z = z;
        }
      },
      state: () => ({
        hero: heroRef.current ? [heroRef.current.position.x, heroRef.current.position.z] : null,
        near: lastNear.current,
        npcs: NPCS.map((n) => ({ id: n.id, pos: [n.x, n.z] })),
        entrance: ENTRANCE,
        stage: decor.stage,
        stageName: VILLAGE_STAGE_NAMES[decor.stage],
        fencePieces: decor.fence.length,
        flowers: decor.flowers.length,
      }),
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__d100town;
    };
  }, [decor]);

  useFrame((frameState, delta) => {
    const devWin = window as unknown as Record<string, unknown>;
    const fixdt = import.meta.env.DEV ? Number(devWin.__d100fixdt) || 0 : 0;
    const dt = fixdt > 0 ? fixdt : Math.min(delta, 0.05);
    const t = frameState.clock.elapsedTime;
    const h = heroRef.current;
    if (!h) return;

    if (!pausedRef.current) {
      const d = input.current;
      const mag = Math.hypot(d.x, d.z);
      if (mag > 0.01) {
        const spd = 6.5;
        const nx = h.position.x + d.x * spd * dt;
        const nz = h.position.z + d.z * spd * dt;
        if (canWalk(nx, h.position.z)) h.position.x = nx;
        if (canWalk(h.position.x, nz)) h.position.z = nz;
        h.rotation.y = Math.atan2(d.x, d.z);
        h.position.y = Math.abs(Math.sin(t * 10)) * 0.08;
      } else {
        h.position.y = 0;
      }
    }

    // ── 가까운 상호작용 대상 탐지 (바뀔 때만 보고)
    let near: TownTarget = null;
    let bestD = NEAR_R;
    for (const n of NPCS) {
      const dd = Math.hypot(n.x - h.position.x, n.z - h.position.z);
      if (dd < bestD) {
        bestD = dd;
        near = n.id;
      }
    }
    const ed = Math.hypot(ENTRANCE[0] - h.position.x, ENTRANCE[1] - h.position.z);
    if (ed < bestD) {
      bestD = ed;
      near = 'entrance';
    }
    if (near !== lastNear.current) {
      lastNear.current = near;
      onNear(near);
    }

    // ── NPC 연출 (둥실둥실 + 가까이 가면 강조)
    NPCS.forEach((n, i) => {
      const g = npcRefs.current[i];
      if (!g) return;
      g.position.y = Math.abs(Math.sin(t * 2 + i)) * 0.05;
      g.rotation.y = Math.sin(t * 0.6 + i) * 0.3;
      const target = near === n.id ? 1.12 : 1;
      const s = g.scale.x + (target - g.scale.x) * Math.min(1, dt * 8);
      g.scale.setScalar(s);
    });

    // ── 던전 입구 (소용돌이 + 가까이 가면 밝아짐)
    if (entranceRef.current) entranceRef.current.rotation.y = t * 1.2;
    if (entranceLightRef.current) {
      const base = near === 'entrance' ? 3.4 : 2.0;
      entranceLightRef.current.intensity = base + Math.sin(t * 3) * 0.5;
    }

    // ── 카메라 (던전과 같은 탑다운, 조금 더 높이 잡아 마을을 보여줌)
    const cam = frameState.camera;
    const k = 1 - Math.pow(0.001, dt);
    cam.position.lerp(new THREE.Vector3(h.position.x * 0.7, 14, h.position.z + 10.5), k);
    cam.lookAt(h.position.x * 0.5, 0.5, h.position.z - 1.5);
  });

  return (
    <group>
      <ambientLight intensity={cfg.ambient} />
      <directionalLight position={cfg.dirPos} intensity={cfg.dirInt} color={cfg.dirColor} />
      <hemisphereLight args={[cfg.hemiSky, cfg.hemiGround, cfg.hemiInt]} />

      {/* 광장 바닥 (돌바닥 타일 — 시절 팔레트) */}
      {Array.from({ length: 11 }, (_, gy) =>
        Array.from({ length: 11 }, (_, gx) => {
          const wx = (gx - 5) * (TR * 2 / 11);
          const wz = (gy - 5) * (TR * 2 / 11);
          return (
            <mesh key={`${gx}:${gy}`} position={[wx, -0.15, wz]} receiveShadow>
              <boxGeometry args={[TR * 2 / 11, 0.3, TR * 2 / 11]} />
              <meshStandardMaterial color={(gx + gy) % 2 === 0 ? cfg.groundA : cfg.groundB} />
            </mesh>
          );
        }),
      )}

      {/* 광장 둘레 담장 — 조각 단위 (험한 시절엔 사라지고 기운다) */}
      {decor.fence.map((f, i) => (
        <mesh
          key={`fence${i}`}
          position={[f.x, 0.35 - (Math.abs(f.tiltX) + Math.abs(f.tiltZ)) * 0.8, f.z]}
          rotation={[f.tiltX, 0, f.tiltZ]}
        >
          <boxGeometry args={[f.w, 0.7, f.d]} />
          <meshStandardMaterial color={cfg.fence} />
        </mesh>
      ))}

      {/* 바닥 장식 — 낙엽 / 그을음 */}
      {decor.patches.map((p, i) => (
        <mesh key={`leaf${i}`} position={[p.x, 0.012, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[p.r, 10]} />
          <meshStandardMaterial color={p.c} transparent opacity={0.75} />
        </mesh>
      ))}
      {decor.scorches.map((p, i) => (
        <mesh key={`scorch${i}`} position={[p.x, 0.012, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[p.r, 12]} />
          <meshStandardMaterial color="#1d1826" transparent opacity={0.85} />
        </mesh>
      ))}

      {/* 잔해 / 궤짝 / 통나무 방벽 / 꽃 */}
      {decor.rubbles.map((p, i) => (
        <mesh key={`rub${i}`} position={[p.x, p.s / 2, p.z]} rotation={[0, p.rot, 0]}>
          <boxGeometry args={[p.s * 1.4, p.s, p.s]} />
          <meshStandardMaterial color={p.c} />
        </mesh>
      ))}
      {decor.crates.map((p, i) => (
        <mesh key={`crate${i}`} position={[p.x, 0.3, p.z]} rotation={[0, p.rot, 0]}>
          <boxGeometry args={[0.6, 0.6, 0.6]} />
          <meshStandardMaterial color="#7a5b3a" />
        </mesh>
      ))}
      {decor.spikes.map((p, i) => (
        <group key={`spk${i}`} position={[p.x, 0, p.z]} rotation={[0, p.rot, 0]}>
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, 0.8]}>
            <cylinderGeometry args={[0.09, 0.12, 1.7, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 0.5, 0]} rotation={[0, 0, -0.8]}>
            <cylinderGeometry args={[0.09, 0.12, 1.7, 6]} />
            <meshStandardMaterial color="#5d3f27" />
          </mesh>
        </group>
      ))}
      {decor.flowers.map((p, i) => (
        <group key={`flw${i}`} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.14, 0]}>
            <cylinderGeometry args={[0.022, 0.03, 0.28, 5]} />
            <meshStandardMaterial color="#5f7a4a" />
          </mesh>
          <mesh position={[0, 0.32, 0]}>
            <sphereGeometry args={[0.09, 8, 8]} />
            <meshStandardMaterial color={p.c} emissive={p.c} emissiveIntensity={0.25} />
          </mesh>
        </group>
      ))}

      {/* 모닥불 (요새 시절 — 우물가에 주민들이 모여 불을 피운다) */}
      {cfg.campfire && (
        <group position={[2.6, 0, 2.0]}>
          <mesh position={[-0.2, 0.1, 0]} rotation={[0, 0.4, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.09, 0.9, 6]} />
            <meshStandardMaterial color="#5d3f27" />
          </mesh>
          <mesh position={[0.15, 0.1, 0.1]} rotation={[0, -0.7, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.09, 0.9, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <coneGeometry args={[0.26, 0.6, 8]} />
            <meshStandardMaterial color="#ff8a3c" emissive="#ff6a1c" emissiveIntensity={1.6} />
          </mesh>
          <pointLight color="#ff9a4a" intensity={1.8} distance={8} position={[0, 1, 0]} />
        </group>
      )}

      {/* 횃불 (습격 이후 — 우물가를 밝힌다) */}
      {cfg.torch && (
        <group position={[1.5, 0, -0.9]}>
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.05, 0.07, 1.6, 6]} />
            <meshStandardMaterial color="#4a3826" />
          </mesh>
          <mesh position={[0, 1.68, 0]}>
            <boxGeometry args={[0.16, 0.2, 0.16]} />
            <meshStandardMaterial color="#ffca6a" emissive="#ffa63c" emissiveIntensity={1.4} />
          </mesh>
          <pointLight color="#ffb356" intensity={1.2} distance={6} position={[0, 1.9, 0]} />
        </group>
      )}

      {/* 건물 (벽 + 지붕 — 시절 따라 기울고, 꺼진 창은 판자로 막힌다) */}
      {BUILDINGS.map((b, i) => (
        <group key={i} position={[b.cx, 0, b.cz]}>
          <mesh position={[0, b.h / 2, 0]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.wall} />
          </mesh>
          <mesh position={[0, b.h + 0.35, 0]} rotation={[0, Math.PI / 4, decor.roofTilts[i]]}>
            <coneGeometry args={[Math.max(b.w, b.d) * 0.82, 1.1, 4]} />
            <meshStandardMaterial color={b.roof} />
          </mesh>
          {/* 문 */}
          <mesh position={[0, 0.6, b.d / 2 + 0.02]}>
            <boxGeometry args={[0.8, 1.2, 0.08]} />
            <meshStandardMaterial color="#2a2038" />
          </mesh>
          {/* 창문 — 불이 켜져 있거나, 판자로 막혀 있거나 */}
          <mesh position={[b.w / 2 - 0.4, b.h * 0.6, b.d / 2 + 0.03]}>
            <boxGeometry args={[0.5, 0.5, 0.06]} />
            {cfg.windowsLit[i] ? (
              <meshStandardMaterial color="#ffd98a" emissive="#ffb347" emissiveIntensity={0.9} />
            ) : (
              <meshStandardMaterial color="#241d30" />
            )}
          </mesh>
          {!cfg.windowsLit[i] && (
            <mesh position={[b.w / 2 - 0.4, b.h * 0.6, b.d / 2 + 0.07]} rotation={[0, 0, 0.5]}>
              <boxGeometry args={[0.72, 0.14, 0.04]} />
              <meshStandardMaterial color="#6b4a2f" />
            </mesh>
          )}
          {/* 폐허 시절 — 여관 모서리가 무너져 있다 */}
          {cfg.ruinChunk && i === 1 && (
            <>
              <mesh position={[b.w / 2 - 0.15, 0.4, -b.d / 2 + 0.4]} rotation={[0.25, 0.5, 0.45]}>
                <boxGeometry args={[1.15, 0.85, 0.55]} />
                <meshStandardMaterial color="#4a3f55" />
              </mesh>
              <mesh position={[b.w / 2 + 0.55, 0.18, 0.3]} rotation={[0, 0.9, 0]}>
                <boxGeometry args={[0.5, 0.36, 0.4]} />
                <meshStandardMaterial color="#3d3448" />
              </mesh>
            </>
          )}
        </group>
      ))}

      {/* 마을 우물 */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.85, 0.95, 0.6, 12]} />
          <meshStandardMaterial color="#5a4a72" />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.7, 0.7, 0.14, 12]} />
          <meshStandardMaterial color="#2a3a5a" emissive="#16324f" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0, 1.5, 0]} rotation={[0, Math.PI / 4, decor.roofTilts[0] * 0.6]}>
          <coneGeometry args={[1.0, 0.7, 4]} />
          <meshStandardMaterial color="#3c2f66" />
        </mesh>
      </group>

      {/* 나무 — 시절 따라 물들고, 잎이 지고, 기운다 */}
      {decor.trees.map((tr, i) => (
        <group key={`tree${i}`} position={[tr.x, 0, tr.z]} rotation={[0, 0, tr.lean]}>
          <mesh position={[0, tr.h / 2, 0]}>
            <cylinderGeometry args={[0.16, 0.22, tr.h, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          {cfg.bare ? (
            <>
              <mesh position={[-0.18, tr.h + 0.28, 0]} rotation={[0, 0, 0.7]}>
                <cylinderGeometry args={[0.04, 0.07, 0.75, 5]} />
                <meshStandardMaterial color="#5d4530" />
              </mesh>
              <mesh position={[0.2, tr.h + 0.34, 0.05]} rotation={[0.2, 0, -0.6]}>
                <cylinderGeometry args={[0.04, 0.07, 0.85, 5]} />
                <meshStandardMaterial color="#5d4530" />
              </mesh>
              <mesh position={[0, tr.h + 0.42, -0.15]} rotation={[-0.5, 0, 0.1]}>
                <cylinderGeometry args={[0.03, 0.06, 0.6, 5]} />
                <meshStandardMaterial color="#54402c" />
              </mesh>
            </>
          ) : (
            <mesh position={[0, tr.h + 0.55, 0]}>
              <icosahedronGeometry args={[0.75, 0]} />
              <meshStandardMaterial color={tr.leaf} />
            </mesh>
          )}
        </group>
      ))}

      {/* 던전 입구 아치 + 소용돌이 포털 */}
      <group position={[ENTRANCE[0], 0, ENTRANCE[1]]}>
        <mesh position={[-1.0, 1.3, 0]}>
          <boxGeometry args={[0.5, 2.6, 0.6]} />
          <meshStandardMaterial color="#3a3452" />
        </mesh>
        <mesh position={[1.0, 1.3, 0]}>
          <boxGeometry args={[0.5, 2.6, 0.6]} />
          <meshStandardMaterial color="#3a3452" />
        </mesh>
        <mesh position={[0, 2.75, 0]}>
          <boxGeometry args={[2.6, 0.5, 0.6]} />
          <meshStandardMaterial color="#2f2a45" />
        </mesh>
        <group ref={entranceRef} position={[0, 1.3, 0]}>
          <mesh>
            <torusGeometry args={[0.72, 0.14, 10, 32]} />
            <meshStandardMaterial color="#8f6bff" emissive="#7a4dff" emissiveIntensity={1.4} />
          </mesh>
          <mesh>
            <circleGeometry args={[0.66, 24]} />
            <meshStandardMaterial color="#160f2c" emissive="#2a1060" emissiveIntensity={0.5} side={THREE.DoubleSide} />
          </mesh>
        </group>
        <pointLight ref={entranceLightRef} color="#9a6bff" intensity={2} distance={8} position={[0, 1.6, 0.5]} />
        <sprite position={[0, 3.5, 0]} scale={[2.4, 0.82, 1]}>
          <spriteMaterial map={labels.door} transparent depthWrite={false} />
        </sprite>
      </group>

      {/* NPC (블록 캐릭터 + 이름표) */}
      {NPCS.map((n, i) => (
        <group key={n.id} ref={(g) => (npcRefs.current[i] = g)} position={[n.x, 0, n.z]}>
          <mesh position={[0, 0.6, 0]}>
            <boxGeometry args={[0.6, 0.7, 0.4]} />
            <meshStandardMaterial color={n.body} />
          </mesh>
          <mesh position={[0, 1.18, 0]}>
            <boxGeometry args={[0.48, 0.44, 0.44]} />
            <meshStandardMaterial color={n.head} />
          </mesh>
          <mesh position={[-0.1, 1.2, 0.23]}>
            <boxGeometry args={[0.07, 0.09, 0.02]} />
            <meshStandardMaterial color="#2a2333" />
          </mesh>
          <mesh position={[0.1, 1.2, 0.23]}>
            <boxGeometry args={[0.07, 0.09, 0.02]} />
            <meshStandardMaterial color="#2a2333" />
          </mesh>
          <sprite position={[0, 1.95, 0]} scale={[1.7, 0.58, 1]}>
            <spriteMaterial map={labelByNpc(n.id)} transparent depthWrite={false} />
          </sprite>
        </group>
      ))}

      {/* 주인공 */}
      <group ref={heroRef} position={[HERO_START[0], 0, HERO_START[1]]}>
        <Hero />
      </group>
    </group>
  );
}
