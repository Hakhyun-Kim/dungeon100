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
  flash: number; // 피격 시 1 → 0으로 감쇠 (흰색 번쩍)
}

interface Shot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number; // 남은 사거리
  alive: boolean;
}

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

function DungeonScene({
  floorNo,
  statsRef,
  pausedRef,
  quizResultRef,
  onDamage,
  onKill,
  onExit,
  onChest,
}: {
  floorNo: number;
  statsRef: React.MutableRefObject<Stats>;
  pausedRef: React.MutableRefObject<boolean>;
  quizResultRef: React.MutableRefObject<QuizResult | null>;
  onDamage: (dmg: number) => void;
  onKill: () => void;
  onExit: () => void;
  onChest: () => void;
}) {
  const floor = useMemo(() => generateFloor(floorNo), [floorNo]);
  const input = useMoveInput();

  const playerRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const orbs = useRef<(THREE.Mesh | null)[]>([null, null, null, null]);
  const portalRef = useRef<THREE.Group>(null);
  const chestRef = useRef<THREE.Group>(null);
  const floorMeshRef = useRef<THREE.InstancedMesh>(null);
  const wallMeshRef = useRef<THREE.InstancedMesh>(null);
  const enemyMeshRef = useRef<THREE.InstancedMesh>(null);
  const shotMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);

  const enemies = useRef<Enemy[]>(
    floor.spawns.map((s) => {
      const [wx, wz] = cellToWorld(s.x, s.y);
      return {
        x: wx,
        z: wz,
        hp: 18 + floorNo * 7,
        alive: true,
        hitCd: 0,
        wobble: Math.random() * 6,
        flash: 0,
      };
    }),
  );
  const shots = useRef<Shot[]>(
    Array.from({ length: MAX_SHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, alive: false })),
  );
  const particles = useRef<Particle[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0, max: 1, size: 0.1, alive: false,
      color: new THREE.Color(),
    })),
  );
  const fireTimer = useRef(0);
  const exited = useRef(false);
  const shake = useRef(0);
  const glowTimer = useRef(0);
  const sparkleTimer = useRef(0.4);
  const chestState = useRef<'idle' | 'pending' | 'opened' | 'failed'>('idle');
  const seenQuizSeq = useRef(quizResultRef.current?.seq ?? 0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // 자주 쓰는 색은 미리 만들어 재사용 (프레임 중 할당 방지)
  const palette = useMemo(
    () => ({
      enemyBase: new THREE.Color('#ff5d7e'),
      white: new THREE.Color('#ffffff'),
      tmp: new THREE.Color(),
      shotTiers: [new THREE.Color('#ffd166'), new THREE.Color('#ff9a3d'), new THREE.Color('#ff5136')],
    }),
    [],
  );

  const [startX, startZ] = useMemo(() => cellToWorld(floor.start.x, floor.start.y), [floor]);
  const [exitX, exitZ] = useMemo(() => cellToWorld(floor.exit.x, floor.exit.y), [floor]);
  const chestPos = useMemo(
    () => (floor.chest ? cellToWorld(floor.chest.x, floor.chest.y) : null),
    [floor],
  );

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
      state: () => ({
        player: playerRef.current
          ? [playerRef.current.position.x, playerRef.current.position.z]
          : null,
        chestWorld: chestPos,
        chestState: chestState.current,
        exit: [exitX, exitZ],
        enemiesAlive: enemies.current.filter((e) => e.alive).length,
      }),
    };
  }, [chestPos, exitX, exitZ]);

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

    // ── 수수께끼 결과 반영 (보물 개봉/실패 연출)
    const qr = quizResultRef.current;
    if (qr && qr.seq !== seenQuizSeq.current) {
      seenQuizSeq.current = qr.seq;
      if (chestState.current === 'pending' && chestPos) {
        chestState.current = qr.ok ? 'opened' : 'failed';
        if (qr.ok) {
          burst(chestPos[0], 0.8, chestPos[1], '#ffd166', 26, 2.2);
          burst(chestPos[0], 0.8, chestPos[1], '#fff3c4', 10, 1.2);
          shake.current = Math.min(0.6, shake.current + 0.22);
          glowTimer.current = 1.6;
        } else {
          burst(chestPos[0], 0.7, chestPos[1], '#8d86a8', 10, 1.1);
        }
        // 퀴즈 직후 바로 얻어맞지 않게 잠깐의 자비
        for (const e of enemies.current) e.hitCd = Math.max(e.hitCd, 0.9);
      }
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

      // ── 투사체 (명중 시: 번쩍 + 스파크 + 넉백)
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
            e.flash = 1;
            sh.alive = false;
            burst(e.x, 0.7, e.z, '#ffe08a', 4, 1.4);
            // 넉백 (벽은 통과 못 함)
            const kx = e.x + sh.dx * 0.4;
            const kz = e.z + sh.dz * 0.4;
            if (canStand(floor.cells, kx, e.z, 0.38)) e.x = kx;
            if (canStand(floor.cells, e.x, kz, 0.38)) e.z = kz;
            if (e.hp <= 0) {
              e.alive = false;
              burst(e.x, 0.7, e.z, '#ff5d7e', 12, 2.0);
              shake.current = Math.min(0.6, shake.current + 0.1);
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
          shake.current = Math.min(0.6, shake.current + 0.3);
          burst(p.position.x, 0.8, p.position.z, '#ff4d5e', 6, 1.6);
          onDamage(6 + floorNo);
        }
      }

      // ── 보물상자 접촉 → 수수께끼
      if (chestState.current === 'idle' && chestPos) {
        if (Math.hypot(p.position.x - chestPos[0], p.position.z - chestPos[1]) < 1.05) {
          chestState.current = 'pending';
          onChest();
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

      // ── 출구 포털
      if (!exited.current && Math.hypot(p.position.x - exitX, p.position.z - exitZ) < 1.3) {
        exited.current = true;
        onExit();
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
    const em = enemyMeshRef.current;
    if (em) {
      enemies.current.forEach((e, i) => {
        if (e.alive) {
          e.flash = Math.max(0, e.flash - dt * 6);
          dummy.position.set(e.x, 0.55 + Math.sin(t * 4 + e.wobble) * 0.1, e.z);
          dummy.rotation.set(0, t * 1.5 + e.wobble, 0);
          const squash = 1 + e.flash * 0.25; // 맞는 순간 살짝 부풀며 번쩍
          dummy.scale.set(squash, squash, squash);
          palette.tmp.copy(palette.enemyBase).lerp(palette.white, e.flash);
          em.setColorAt(i, palette.tmp);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        em.setMatrixAt(i, dummy.matrix);
      });
      em.instanceMatrix.needsUpdate = true;
      if (em.instanceColor) em.instanceColor.needsUpdate = true;
    }

    const sm = shotMeshRef.current;
    if (sm) {
      const tier = stats.damage < 16 ? 0 : stats.damage < 28 ? 1 : 2;
      const shotScale = Math.min(1.9, 1 + (stats.damage / 10 - 1) * 0.3);
      shots.current.forEach((sh, i) => {
        if (sh.alive) {
          dummy.position.set(sh.x, 0.75, sh.z);
          dummy.scale.set(shotScale, shotScale, shotScale);
          sm.setColorAt(i, palette.shotTiers[tier]);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.rotation.set(0, 0, 0);
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

    // ── 카메라 추적 + 셰이크
    shake.current = Math.max(0, shake.current - dt * 1.6);
    const cam = state.camera;
    const k = 1 - Math.pow(0.001, dt);
    cam.position.lerp(new THREE.Vector3(p.position.x, 15.5, p.position.z + 9.5), k);
    const s2 = shake.current * shake.current;
    cam.position.x += (Math.random() - 0.5) * s2 * 1.6;
    cam.position.z += (Math.random() - 0.5) * s2 * 1.6;
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

      {/* 적 (피격 시 흰색 번쩍 — 인스턴스 색상) */}
      <instancedMesh ref={enemyMeshRef} args={[undefined, undefined, enemies.current.length]} frustumCulled={false}>
        <boxGeometry args={[0.9, 0.9, 0.9]} />
        <meshStandardMaterial emissive="#5c1024" emissiveIntensity={0.6} />
      </instancedMesh>

      {/* 투사체 (공격력에 따라 크기·색 변화) */}
      <instancedMesh ref={shotMeshRef} args={[undefined, undefined, MAX_SHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 10, 10]} />
        <meshStandardMaterial emissive="#ffb020" emissiveIntensity={1.6} />
      </instancedMesh>

      {/* 파티클 (타격 스파크·처치 폭발·보물 반짝임) */}
      <instancedMesh ref={particleMeshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* 플레이어 (블록 캐릭터 + 파워업 시각화) */}
      <group ref={playerRef} position={[startX, 0, startZ]}>
        <group ref={bodyRef}>
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
        {/* 멀티샷 궤도 구슬 */}
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} ref={(m) => (orbs.current[i] = m)} scale={0.0001}>
            <sphereGeometry args={[0.11, 8, 8]} />
            <meshStandardMaterial color="#ffd166" emissive="#ffb020" emissiveIntensity={1.4} />
          </mesh>
        ))}
        {/* 보물 획득 황금 잔광 */}
        <pointLight ref={glowRef} color="#ffcf5c" intensity={0} distance={7} position={[0, 1.2, 0]} />
      </group>

      {/* 보물상자 */}
      {chestPos && (
        <group ref={chestRef} position={[chestPos[0], 0, chestPos[1]]}>
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
