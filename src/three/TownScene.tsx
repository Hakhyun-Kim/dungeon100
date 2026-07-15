import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Hero from './Hero';
import { useMoveInput } from './DungeonScene';
import { makeTextTexture } from './textTexture';

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

export default function TownScene({
  pausedRef,
  onNear,
}: {
  pausedRef: React.MutableRefObject<boolean>;
  onNear: (t: TownTarget) => void;
}) {
  const input = useMoveInput();
  const heroRef = useRef<THREE.Group>(null);
  const npcRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const entranceRef = useRef<THREE.Group>(null);
  const entranceLightRef = useRef<THREE.PointLight>(null);
  // undefined로 시작 → 마운트 후 첫 프레임에 실제 근접값(보통 null)을 반드시 1회 보고.
  // (상점 등에서 씬이 리마운트될 때 App의 stale한 '무크와 대화' 버튼을 확실히 지운다)
  const lastNear = useRef<TownTarget | undefined>(undefined);

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
      }),
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__d100town;
    };
  }, []);

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
      <ambientLight intensity={0.72} />
      <directionalLight position={[8, 16, 6]} intensity={1.0} />
      <hemisphereLight args={['#b9c8ff', '#3a2f55', 0.5]} />

      {/* 광장 바닥 (돌바닥 타일) */}
      {Array.from({ length: 11 }, (_, gy) =>
        Array.from({ length: 11 }, (_, gx) => {
          const wx = (gx - 5) * (TR * 2 / 11);
          const wz = (gy - 5) * (TR * 2 / 11);
          return (
            <mesh key={`${gx}:${gy}`} position={[wx, -0.15, wz]} receiveShadow>
              <boxGeometry args={[TR * 2 / 11, 0.3, TR * 2 / 11]} />
              <meshStandardMaterial color={(gx + gy) % 2 === 0 ? '#4a4066' : '#544a72'} />
            </mesh>
          );
        }),
      )}

      {/* 광장 둘레 낮은 담장 */}
      {[
        [0, TR, TR * 2 + 1, 0.4],
        [0, -TR, TR * 2 + 1, 0.4],
        [TR, 0, 0.4, TR * 2 + 1],
        [-TR, 0, 0.4, TR * 2 + 1],
      ].map(([px, pz, sw, sd], i) => (
        <mesh key={i} position={[px, 0.35, pz]}>
          <boxGeometry args={[sw, 0.7, sd]} />
          <meshStandardMaterial color="#3a3055" />
        </mesh>
      ))}

      {/* 건물 (벽 + 지붕) */}
      {BUILDINGS.map((b, i) => (
        <group key={i} position={[b.cx, 0, b.cz]}>
          <mesh position={[0, b.h / 2, 0]}>
            <boxGeometry args={[b.w, b.h, b.d]} />
            <meshStandardMaterial color={b.wall} />
          </mesh>
          <mesh position={[0, b.h + 0.35, 0]} rotation={[0, Math.PI / 4, 0]}>
            <coneGeometry args={[Math.max(b.w, b.d) * 0.82, 1.1, 4]} />
            <meshStandardMaterial color={b.roof} />
          </mesh>
          {/* 문 */}
          <mesh position={[0, 0.6, b.d / 2 + 0.02]}>
            <boxGeometry args={[0.8, 1.2, 0.08]} />
            <meshStandardMaterial color="#2a2038" />
          </mesh>
          {/* 창문 불빛 */}
          <mesh position={[b.w / 2 - 0.4, b.h * 0.6, b.d / 2 + 0.03]}>
            <boxGeometry args={[0.5, 0.5, 0.06]} />
            <meshStandardMaterial color="#ffd98a" emissive="#ffb347" emissiveIntensity={0.9} />
          </mesh>
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
        <mesh position={[0, 1.5, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[1.0, 0.7, 4]} />
          <meshStandardMaterial color="#3c2f66" />
        </mesh>
      </group>

      {/* 나무 */}
      {TREES.map(([tx, tz], i) => (
        <group key={i} position={[tx, 0, tz]}>
          <mesh position={[0, 0.5, 0]}>
            <cylinderGeometry args={[0.16, 0.22, 1.0, 6]} />
            <meshStandardMaterial color="#6b4a2f" />
          </mesh>
          <mesh position={[0, 1.4, 0]}>
            <icosahedronGeometry args={[0.75, 0]} />
            <meshStandardMaterial color="#4f8a4a" />
          </mesh>
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
