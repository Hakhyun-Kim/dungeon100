import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CELL, canStand, cellToWorld, generateFloor, GRID, isFloor } from '../lib/dungeon';
import type { Stats } from '../lib/upgrades';

// 층 하나의 3D 씬 + 시뮬레이션. 층이 바뀌면 부모가 key로 리마운트한다.
interface Enemy {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  hitCd: number;
  wobble: number;
}

interface Shot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number; // 남은 사거리
  alive: boolean;
}

const MAX_SHOTS = 48;
const SHOT_SPEED = 15;
const AGGRO = 9;

function DungeonScene({
  floorNo,
  statsRef,
  pausedRef,
  onDamage,
  onKill,
  onExit,
}: {
  floorNo: number;
  statsRef: React.MutableRefObject<Stats>;
  pausedRef: React.MutableRefObject<boolean>;
  onDamage: (dmg: number) => void;
  onKill: () => void;
  onExit: () => void;
}) {
  const floor = useMemo(() => generateFloor(floorNo), [floorNo]);
  const input = useMoveInput();

  const playerRef = useRef<THREE.Group>(null);
  const portalRef = useRef<THREE.Group>(null);
  const floorMeshRef = useRef<THREE.InstancedMesh>(null);
  const wallMeshRef = useRef<THREE.InstancedMesh>(null);
  const enemyMeshRef = useRef<THREE.InstancedMesh>(null);
  const shotMeshRef = useRef<THREE.InstancedMesh>(null);

  const enemies = useRef<Enemy[]>(
    floor.spawns.map((s) => {
      const [wx, wz] = cellToWorld(s.x, s.y);
      return { x: wx, z: wz, hp: 18 + floorNo * 7, alive: true, hitCd: 0, wobble: Math.random() * 6 };
    }),
  );
  const shots = useRef<Shot[]>(
    Array.from({ length: MAX_SHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, alive: false })),
  );
  const fireTimer = useRef(0);
  const exited = useRef(false);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const [startX, startZ] = useMemo(() => cellToWorld(floor.start.x, floor.start.y), [floor]);
  const [exitX, exitZ] = useMemo(() => cellToWorld(floor.exit.x, floor.exit.y), [floor]);

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

  // 정적 지형 인스턴스 배치 (마운트 시 1회)
  useLayoutEffect(() => {
    const fm = floorMeshRef.current;
    if (fm) {
      const c1 = new THREE.Color('#3a2f55');
      const c2 = new THREE.Color('#453a63');
      floorCells.forEach(([x, y], i) => {
        const [wx, wz] = cellToWorld(x, y);
        dummy.position.set(wx, -0.15, wz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        fm.setMatrixAt(i, dummy.matrix);
        fm.setColorAt(i, (x + y) % 2 === 0 ? c1 : c2);
      });
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    }
    const wm = wallMeshRef.current;
    if (wm) {
      wallCells.forEach(([x, y], i) => {
        const [wx, wz] = cellToWorld(x, y);
        dummy.position.set(wx, 1.3, wz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        wm.setMatrixAt(i, dummy.matrix);
      });
      wm.instanceMatrix.needsUpdate = true;
    }
  }, [floorCells, wallCells, dummy]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const stats = statsRef.current;
    const p = playerRef.current;
    if (!p) return;

    if (portalRef.current) {
      portalRef.current.rotation.y = t * 1.4;
      portalRef.current.position.y = 1.1 + Math.sin(t * 2) * 0.12;
    }

    if (!pausedRef.current) {
      // ── 플레이어 이동 (그리드 충돌)
      const d = input.current;
      const mag = Math.hypot(d.x, d.z);
      if (mag > 0.01) {
        const nx = p.position.x + d.x * stats.speed * dt;
        const nz = p.position.z + d.z * stats.speed * dt;
        if (canStand(floor.cells, nx, p.position.z, 0.42)) p.position.x = nx;
        if (canStand(floor.cells, p.position.x, nz, 0.42)) p.position.z = nz;
        p.rotation.y = Math.atan2(d.x, d.z);
        p.position.y = Math.abs(Math.sin(t * 10)) * 0.08; // 달리기 통통
      } else {
        p.position.y = 0;
      }

      // ── 자동 조준 발사
      fireTimer.current -= dt;
      if (fireTimer.current <= 0) {
        let best: Enemy | null = null;
        let bestD = stats.range;
        for (const e of enemies.current) {
          if (!e.alive) continue;
          const dist = Math.hypot(e.x - p.position.x, e.z - p.position.z);
          if (dist < bestD) {
            bestD = dist;
            best = e;
          }
        }
        if (best) {
          const base = Math.atan2(best.x - p.position.x, best.z - p.position.z);
          for (let s = 0; s < stats.shots; s++) {
            const slot = shots.current.find((sh) => !sh.alive);
            if (!slot) break;
            const ang = base + (s - (stats.shots - 1) / 2) * 0.16;
            slot.x = p.position.x;
            slot.z = p.position.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = stats.range;
            slot.alive = true;
          }
          fireTimer.current = 1 / stats.fireRate;
        }
      }

      // ── 투사체
      for (const sh of shots.current) {
        if (!sh.alive) continue;
        sh.x += sh.dx * SHOT_SPEED * dt;
        sh.z += sh.dz * SHOT_SPEED * dt;
        sh.left -= SHOT_SPEED * dt;
        const cx = Math.floor(sh.x / CELL + GRID / 2);
        const cz = Math.floor(sh.z / CELL + GRID / 2);
        if (sh.left <= 0 || !isFloor(floor.cells, cx, cz)) {
          sh.alive = false;
          continue;
        }
        for (const e of enemies.current) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - sh.x, e.z - sh.z) < 0.62) {
            e.hp -= stats.damage;
            sh.alive = false;
            if (e.hp <= 0) {
              e.alive = false;
              onKill();
            }
            break;
          }
        }
      }

      // ── 적 추격 + 접촉 피해
      const espeed = 2.3 + Math.min(2, floorNo * 0.06);
      for (const e of enemies.current) {
        if (!e.alive) continue;
        e.hitCd -= dt;
        const ex = p.position.x - e.x;
        const ez = p.position.z - e.z;
        const dist = Math.hypot(ex, ez);
        if (dist < AGGRO && dist > 0.001) {
          const nx = e.x + (ex / dist) * espeed * dt;
          const nz = e.z + (ez / dist) * espeed * dt;
          if (canStand(floor.cells, nx, e.z, 0.38)) e.x = nx;
          if (canStand(floor.cells, e.x, nz, 0.38)) e.z = nz;
        }
        if (dist < 0.85 && e.hitCd <= 0) {
          e.hitCd = 0.8;
          onDamage(6 + floorNo);
        }
      }

      // ── 출구 포털
      if (!exited.current && Math.hypot(p.position.x - exitX, p.position.z - exitZ) < 1.3) {
        exited.current = true;
        onExit();
      }
    }

    // ── 동적 인스턴스 갱신 (일시정지 중에도 마지막 상태 렌더)
    const em = enemyMeshRef.current;
    if (em) {
      enemies.current.forEach((e, i) => {
        if (e.alive) {
          dummy.position.set(e.x, 0.55 + Math.sin(t * 4 + e.wobble) * 0.1, e.z);
          dummy.rotation.set(0, t * 1.5 + e.wobble, 0);
          dummy.scale.set(1, 1, 1);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        em.setMatrixAt(i, dummy.matrix);
      });
      em.instanceMatrix.needsUpdate = true;
    }
    const sm = shotMeshRef.current;
    if (sm) {
      shots.current.forEach((sh, i) => {
        if (sh.alive) {
          dummy.position.set(sh.x, 0.75, sh.z);
          dummy.scale.set(1, 1, 1);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      });
      sm.instanceMatrix.needsUpdate = true;
    }

    // 개발용 상태 프로브 (숨김 탭 검증·밸런스 시뮬레이터 기초)
    if (import.meta.env.DEV) {
      (window as unknown as { __d100?: object }).__d100 = {
        floorNo,
        px: Math.round(p.position.x * 10) / 10,
        pz: Math.round(p.position.z * 10) / 10,
        alive: enemies.current.filter((e) => e.alive).length,
        liveShots: shots.current.filter((s) => s.alive).length,
      };
    }

    // ── 카메라 추적
    const cam = state.camera;
    const k = 1 - Math.pow(0.001, dt);
    cam.position.lerp(new THREE.Vector3(p.position.x, 15.5, p.position.z + 9.5), k);
    cam.lookAt(p.position.x, 0, p.position.z);
  });

  return (
    <>
      <color attach="background" args={['#140e22']} />
      <fog attach="fog" args={['#140e22', 20, 44]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 14, 4]} intensity={1.0} />

      {/* 바닥 (교대 색) */}
      <instancedMesh ref={floorMeshRef} args={[undefined, undefined, floorCells.length]} frustumCulled={false}>
        <boxGeometry args={[CELL, 0.3, CELL]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* 벽 */}
      <instancedMesh ref={wallMeshRef} args={[undefined, undefined, wallCells.length]} frustumCulled={false}>
        <boxGeometry args={[CELL, 2.6, CELL]} />
        <meshStandardMaterial color="#251c3d" />
      </instancedMesh>

      {/* 적 */}
      <instancedMesh ref={enemyMeshRef} args={[undefined, undefined, enemies.current.length]} frustumCulled={false}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial color="#ff5d7e" emissive="#5c1024" emissiveIntensity={0.6} />
      </instancedMesh>

      {/* 투사체 */}
      <instancedMesh ref={shotMeshRef} args={[undefined, undefined, MAX_SHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 10, 10]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb020" emissiveIntensity={1.6} />
      </instancedMesh>

      {/* 플레이어 (블록 캐릭터) */}
      <group ref={playerRef} position={[startX, 0, startZ]}>
        <mesh position={[0, 0.62, 0]}>
          <boxGeometry args={[0.66, 0.72, 0.42]} />
          <meshStandardMaterial color="#5aa0ff" />
        </mesh>
        <mesh position={[0, 1.24, 0]}>
          <boxGeometry args={[0.52, 0.48, 0.48]} />
          <meshStandardMaterial color="#ffd9a8" />
        </mesh>
        <mesh position={[-0.11, 1.26, 0.25]}>
          <boxGeometry args={[0.07, 0.09, 0.02]} />
          <meshStandardMaterial color="#2a2333" />
        </mesh>
        <mesh position={[0.11, 1.26, 0.25]}>
          <boxGeometry args={[0.07, 0.09, 0.02]} />
          <meshStandardMaterial color="#2a2333" />
        </mesh>
      </group>

      {/* 출구 포털 */}
      <group ref={portalRef} position={[exitX, 1.1, exitZ]}>
        <mesh>
          <torusGeometry args={[0.85, 0.14, 12, 40]} />
          <meshStandardMaterial color="#8f6bff" emissive="#7a4dff" emissiveIntensity={1.4} />
        </mesh>
        <pointLight color="#9a6bff" intensity={2.4} distance={9} />
      </group>
    </>
  );
}

// 키보드(WASD/방향키) + 터치 드래그(가상 스틱) 입력 → 정규화된 이동 벡터
function useMoveInput() {
  const dir = useRef({ x: 0, z: 0 });
  useEffect(() => {
    const keys = new Set<string>();
    const drag = { active: false, ox: 0, oy: 0, x: 0, y: 0 };

    const update = () => {
      let x = 0;
      let z = 0;
      if (keys.has('arrowleft') || keys.has('a')) x -= 1;
      if (keys.has('arrowright') || keys.has('d')) x += 1;
      if (keys.has('arrowup') || keys.has('w')) z -= 1;
      if (keys.has('arrowdown') || keys.has('s')) z += 1;
      if (drag.active) {
        const dx = drag.x - drag.ox;
        const dy = drag.y - drag.oy;
        const len = Math.hypot(dx, dy);
        if (len > 10) {
          const m = Math.min(1, len / 56);
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

    const down = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      update();
    };
    const pdown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      // 버튼·카드 등 UI 위에서는 스틱을 시작하지 않는다
      if ((e.target as HTMLElement).closest('button')) return;
      drag.active = true;
      drag.ox = e.clientX;
      drag.oy = e.clientY;
      drag.x = e.clientX;
      drag.y = e.clientY;
      update();
    };
    const pmove = (e: PointerEvent) => {
      if (!e.isPrimary || !drag.active) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      update();
    };
    const pup = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      drag.active = false;
      update();
    };
    const blur = () => {
      keys.clear();
      drag.active = false;
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
    };
  }, []);
  return dir;
}

export default memo(DungeonScene);
