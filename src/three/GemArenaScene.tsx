import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Stats } from '../lib/upgrades';
import { sfx } from '../lib/sound';
import Hero from './Hero';
import { useMoveInput } from './DungeonScene';

// 몬스터 아레나 — 보물상자 미니게임의 '몬스터' 모드.
// 수학 대신, 우르르 몰려오는 무리를 뚫고 바닥의 보석 3개를 몸으로 주우면 능력치업.
// 본체(던전)와 분리된 아레나 전용 체력을 쓰며, 쓰러져도 본체는 무사 — 몇 번이고 다시 도전.
export const ARENA_MAX_HP = 100;
const ARENA_R = 9; // 아레나 반경 (정사각형 절반)
const MAX_ENEMIES = 48;
const MAX_SHOTS = 48;
const MAX_ESHOTS = 24; // 슈터 탄막 풀
const MAX_PARTICLES = 120;
const SHOT_SPEED = 15;
const ESHOT_SPEED = 6.5;
const GEM_POS: [number, number][] = [
  [0, -6.6],
  [-5.7, 3.4],
  [5.7, 3.4],
];
// 5층 단위 몬스터 티어 색 (던전과 통일)
const TIER_COLORS = ['#ff5d7e', '#7be07a', '#5aa0ff', '#c06bff', '#ffa03d', '#8de0e0'];
const TIER_EMISSIVE = ['#5c1024', '#124d18', '#10315c', '#3c1060', '#5c3a10', '#105050'];

// 본체 던전의 4타입을 아레나에선 1층부터 전부 섞어 '아래층 맛보기' + 긴장감.
type EType = 'chaser' | 'shooter' | 'dasher' | 'tank';
function pickArenaType(): EType {
  const r = Math.random();
  if (r < 0.2) return 'shooter';
  if (r < 0.42) return 'dasher';
  if (r < 0.57) return 'tank';
  return 'chaser';
}

interface AEnemy {
  x: number;
  z: number;
  hp: number;
  alive: boolean;
  hitCd: number;
  wobble: number;
  flash: number;
  type: EType;
  ai: number; // 타입별 타이머 (슈터 발사 쿨다운, 대셔 단계 시간)
  mode: number; // 대셔: 0 접근 / 1 조준 / 2 돌진 / 3 숨 고르기
  adx: number; // 돌진 방향
  adz: number;
}
interface AEShot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number;
  alive: boolean;
}
interface AShot {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number;
  alive: boolean;
}
interface AParticle {
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

export default function GemArenaScene({
  floorNo,
  statsRef,
  onArenaHp,
  onGem,
  onDone,
}: {
  floorNo: number;
  statsRef: React.MutableRefObject<Stats>;
  onArenaHp: (hp: number, max: number) => void;
  onGem: (count: number) => void;
  onDone: (cleared: boolean, gems: number) => void;
}) {
  const input = useMoveInput();
  const charRef = useRef<THREE.Group>(null);
  const enemyMeshRef = useRef<THREE.InstancedMesh>(null);
  const shotMeshRef = useRef<THREE.InstancedMesh>(null);
  const particleMeshRef = useRef<THREE.InstancedMesh>(null);
  const gemRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const enemyTier = Math.floor((floorNo - 1) / 5) % TIER_COLORS.length;
  const palette = useMemo(
    () => ({
      base: new THREE.Color(TIER_COLORS[enemyTier]),
      white: new THREE.Color('#ffffff'),
      tmp: new THREE.Color(),
      shooterTint: new THREE.Color('#ffd166'), // 슈터는 노란빛
    }),
    [enemyTier],
  );

  // 몰려오는 강도 — 1층이라도 10층 던전처럼 빽빽하게 (아래로 갈수록 조금 더)
  const aliveCap = Math.min(18, 10 + Math.floor(floorNo * 0.5));
  const enemyMaxHp = 10 + floorNo * 2.5;
  const touchDmg = 5 + floorNo * 0.35;

  const enemies = useRef<AEnemy[]>(
    Array.from({ length: MAX_ENEMIES }, () => ({
      x: 0, z: 0, hp: 0, alive: false, hitCd: 0, wobble: Math.random() * 6, flash: 0,
      type: 'chaser' as EType, ai: 0, mode: 0, adx: 0, adz: 0,
    })),
  );
  const shots = useRef<AShot[]>(
    Array.from({ length: MAX_SHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, alive: false })),
  );
  const eshots = useRef<AEShot[]>(
    Array.from({ length: MAX_ESHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, alive: false })),
  );
  const eshotMeshRef = useRef<THREE.InstancedMesh>(null);
  const particles = useRef<AParticle[]>(
    Array.from({ length: MAX_PARTICLES }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0, max: 1, size: 0.1, alive: false,
      color: new THREE.Color(),
    })),
  );
  const gems = useRef(GEM_POS.map(([x, z]) => ({ x, z, taken: false })));
  const gemCount = useRef(0);
  const hp = useRef(ARENA_MAX_HP);
  const fireTimer = useRef(0);
  const spawnTimer = useRef(0);
  const shake = useRef(0);
  const doneCalled = useRef(false);
  const clearT = useRef(-1); // 클리어 후 잠깐 축하 → 종료

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

  const spawnEnemy = () => {
    const slot = enemies.current.find((e) => !e.alive);
    if (!slot) return;
    const ang = Math.random() * Math.PI * 2;
    slot.x = Math.cos(ang) * (ARENA_R - 0.8);
    slot.z = Math.sin(ang) * (ARENA_R - 0.8);
    const type = pickArenaType();
    slot.type = type;
    slot.hp = type === 'tank' ? enemyMaxHp * 2.8 : type === 'shooter' ? enemyMaxHp * 0.8 : enemyMaxHp;
    slot.alive = true;
    slot.hitCd = 0.35; // 스폰 직후 바로 안 때리게
    slot.flash = 0;
    slot.wobble = Math.random() * 6;
    slot.ai = Math.random() * 1.2;
    slot.mode = 0;
    slot.adx = 0;
    slot.adz = 0;
  };

  // 시작 시 한 무리 확 몰려오게 + 초기 상태 보고
  useEffect(() => {
    for (let i = 0; i < Math.min(aliveCap, 11); i++) spawnEnemy();
    onArenaHp(ARENA_MAX_HP, ARENA_MAX_HP);
    onGem(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 개발 검증용 훅 (프로덕션 빌드에서는 제외)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__d100arena = {
      place: (x: number, z: number) => {
        const c = charRef.current;
        if (c) {
          c.position.x = x;
          c.position.z = z;
        }
      },
      state: () => ({
        char: charRef.current ? [charRef.current.position.x, charRef.current.position.z] : null,
        hp: hp.current,
        gems: gemCount.current,
        gemPos: gems.current.map((g) => ({ x: g.x, z: g.z, taken: g.taken })),
        enemiesAlive: enemies.current.filter((e) => e.alive).length,
        enemyTypes: enemies.current.reduce(
          (acc, e) => {
            if (e.alive) acc[e.type] = (acc[e.type] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        ),
        eshotsAlive: eshots.current.filter((s) => s.alive).length,
        cleared: clearT.current >= 0,
      }),
      collect: () => {
        // 가장 가까운 남은 보석 위치로 순간이동 (수집 판정은 다음 프레임)
        const g = gems.current.find((gm) => !gm.taken);
        const c = charRef.current;
        if (g && c) {
          c.position.x = g.x;
          c.position.z = g.z;
        }
      },
      hurt: (n: number) => {
        hp.current = Math.max(0, hp.current - n);
      },
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__d100arena;
    };
  }, []);

  useFrame((frameState, delta) => {
    const devWin = window as unknown as Record<string, unknown>;
    const fixdt = import.meta.env.DEV ? Number(devWin.__d100fixdt) || 0 : 0;
    const speedScale = (import.meta.env.DEV && Number(devWin.__d100speed)) || 1;
    const dt = fixdt > 0 ? fixdt : Math.min(delta, 0.05) * speedScale;
    const t = frameState.clock.elapsedTime;
    const stats = statsRef.current;
    const c = charRef.current;
    if (!c) return;
    const bound = ARENA_R - 0.6;

    if (clearT.current >= 0) {
      // 클리어 축하 — 잠깐 색종이 뿌리고 종료
      clearT.current += dt;
      if (clearT.current > 0.9 && !doneCalled.current) {
        doneCalled.current = true;
        onDone(true, 3);
      }
    } else if (!doneCalled.current) {
      // ── 이동 (아레나 경계로 클램프)
      const d = input.current;
      const mag = Math.hypot(d.x, d.z);
      if (mag > 0.01) {
        c.position.x = THREE.MathUtils.clamp(c.position.x + d.x * stats.speed * dt, -bound, bound);
        c.position.z = THREE.MathUtils.clamp(c.position.z + d.z * stats.speed * dt, -bound, bound);
        c.rotation.y = Math.atan2(d.x, d.z);
        c.position.y = Math.abs(Math.sin(t * 10)) * 0.08;
      } else {
        c.position.y = 0;
      }

      // ── 자동 조준 발사 (본체와 동일한 감각)
      fireTimer.current -= dt;
      if (fireTimer.current <= 0) {
        let best: AEnemy | null = null;
        let bestD = stats.range;
        for (const e of enemies.current) {
          if (!e.alive) continue;
          const dist = Math.hypot(e.x - c.position.x, e.z - c.position.z);
          if (dist < bestD) {
            bestD = dist;
            best = e;
          }
        }
        if (best) {
          const base = Math.atan2(best.x - c.position.x, best.z - c.position.z);
          for (let s = 0; s < stats.shots; s++) {
            const slot = shots.current.find((sh) => !sh.alive);
            if (!slot) break;
            const ang = base + (s - (stats.shots - 1) / 2) * 0.16;
            slot.x = c.position.x;
            slot.z = c.position.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = stats.range;
            slot.alive = true;
          }
          fireTimer.current = 1 / stats.fireRate;
        }
      }

      // ── 투사체 (명중 → 번쩍 + 스파크 + 넉백)
      for (const sh of shots.current) {
        if (!sh.alive) continue;
        sh.x += sh.dx * SHOT_SPEED * dt;
        sh.z += sh.dz * SHOT_SPEED * dt;
        sh.left -= SHOT_SPEED * dt;
        if (sh.left <= 0 || Math.abs(sh.x) > ARENA_R || Math.abs(sh.z) > ARENA_R) {
          sh.alive = false;
          continue;
        }
        for (const e of enemies.current) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - sh.x, e.z - sh.z) < 0.62) {
            e.hp -= stats.damage;
            e.flash = 1;
            sh.alive = false;
            sfx.hit();
            burst(e.x, 0.7, e.z, '#ffe08a', 4, 1.4);
            if (e.type !== 'tank') {
              // 탱커는 넉백 면역
              e.x = THREE.MathUtils.clamp(e.x + sh.dx * 0.4, -bound, bound);
              e.z = THREE.MathUtils.clamp(e.z + sh.dz * 0.4, -bound, bound);
            }
            if (e.hp <= 0) {
              e.alive = false;
              burst(e.x, 0.7, e.z, palette.base.getStyle(), 12, 2.0);
              shake.current = Math.min(0.6, shake.current + 0.08);
              sfx.kill();
            }
            break;
          }
        }
      }

      // ── 무리 유지 (죽는 만큼 계속 몰려온다)
      spawnTimer.current -= dt;
      if (spawnTimer.current <= 0) {
        let aliveN = 0;
        for (const e of enemies.current) if (e.alive) aliveN++;
        if (aliveN < aliveCap) {
          spawnEnemy();
          spawnTimer.current = 0.45 + Math.random() * 0.35;
        } else {
          spawnTimer.current = 0.3;
        }
      }

      // ── 적 AI (타입별) + 접촉 피해 — 본체 던전을 1층부터 미리 맛보게
      const espeed = 2.4 + Math.min(2.2, floorNo * 0.06);
      const hurtPlayer = (dmg: number) => {
        hp.current = Math.max(0, hp.current - dmg);
        onArenaHp(hp.current, ARENA_MAX_HP);
        shake.current = Math.min(0.6, shake.current + 0.26);
        burst(c.position.x, 0.8, c.position.z, '#ff4d5e', 6, 1.6);
        sfx.hurt();
        if (hp.current <= 0 && !doneCalled.current) {
          doneCalled.current = true;
          onDone(false, gemCount.current);
        }
      };
      const fireEshot = (fx: number, fz: number, dx: number, dz: number) => {
        const slot = eshots.current.find((s2) => !s2.alive);
        if (!slot) return;
        slot.x = fx;
        slot.z = fz;
        slot.dx = dx;
        slot.dz = dz;
        slot.left = 14;
        slot.alive = true;
      };
      for (const e of enemies.current) {
        if (!e.alive) continue;
        e.hitCd -= dt;
        const ex = c.position.x - e.x;
        const ez = c.position.z - e.z;
        const dist = Math.hypot(ex, ez);
        const ux = dist > 0.001 ? ex / dist : 0;
        const uz = dist > 0.001 ? ez / dist : 0;
        const walk = (dx: number, dz: number, spd: number) => {
          e.x = THREE.MathUtils.clamp(e.x + dx * spd * dt, -bound, bound);
          e.z = THREE.MathUtils.clamp(e.z + dz * spd * dt, -bound, bound);
        };

        if (e.type === 'shooter') {
          // 거리를 유지하며 조준 사격
          e.ai -= dt;
          if (dist < 4.5) walk(-ux, -uz, 2.0);
          else if (dist > 8.5) walk(ux, uz, 1.9);
          if (dist < 11 && e.ai <= 0) {
            e.ai = 2.3;
            fireEshot(e.x, e.z, ux, uz);
          }
        } else if (e.type === 'dasher') {
          // 접근 → 조준(부풀기) → 돌진 → 숨 고르기
          if (e.mode === 0) {
            walk(ux, uz, 2.6);
            if (dist < 6.5) {
              e.mode = 1;
              e.ai = 0.55;
            }
          } else if (e.mode === 1) {
            e.ai -= dt;
            if (e.ai <= 0) {
              e.mode = 2;
              e.ai = 0.5;
              e.adx = ux;
              e.adz = uz;
            }
          } else if (e.mode === 2) {
            e.ai -= dt;
            walk(e.adx, e.adz, 9.5);
            if (e.ai <= 0) {
              e.mode = 3;
              e.ai = 1.1;
            }
          } else {
            e.ai -= dt;
            if (e.ai <= 0) e.mode = 0;
          }
        } else {
          // chaser / tank — 우직하게 접근 (탱커는 느림)
          walk(ux, uz, e.type === 'tank' ? 1.5 : espeed);
        }

        const touchR = e.type === 'tank' ? 1.05 : 0.85;
        if (dist < touchR && e.hitCd <= 0) {
          e.hitCd = e.type === 'dasher' && e.mode === 2 ? 0.6 : 0.8;
          const dmg =
            e.type === 'tank'
              ? touchDmg * 1.5
              : e.type === 'dasher' && e.mode === 2
                ? touchDmg + 3
                : touchDmg;
          hurtPlayer(dmg);
        }
      }

      // ── 슈터 탄막 (플레이어 피격)
      for (const es of eshots.current) {
        if (!es.alive) continue;
        es.x += es.dx * ESHOT_SPEED * dt;
        es.z += es.dz * ESHOT_SPEED * dt;
        es.left -= ESHOT_SPEED * dt;
        if (es.left <= 0 || Math.abs(es.x) > ARENA_R || Math.abs(es.z) > ARENA_R) {
          es.alive = false;
          continue;
        }
        if (Math.hypot(es.x - c.position.x, es.z - c.position.z) < 0.55) {
          es.alive = false;
          hurtPlayer(touchDmg * 0.8);
        }
      }

      // ── 보석 획득 (몸으로 줍기)
      for (const g of gems.current) {
        if (g.taken) continue;
        if (Math.hypot(c.position.x - g.x, c.position.z - g.z) < 1.0) {
          g.taken = true;
          gemCount.current += 1;
          burst(g.x, 1.0, g.z, '#8de0ff', 18, 2.2);
          burst(g.x, 1.0, g.z, '#ffffff', 8, 1.4);
          shake.current = Math.min(0.6, shake.current + 0.15);
          onGem(gemCount.current);
          if (gemCount.current >= 3) {
            sfx.legend();
            burst(c.position.x, 1.2, c.position.z, '#ffd166', 24, 2.6);
            clearT.current = 0;
          } else {
            sfx.treasure();
          }
        }
      }
    }

    // ── 파티클 물리
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

    // ── 적 인스턴스 갱신
    const em = enemyMeshRef.current;
    if (em) {
      enemies.current.forEach((e, i) => {
        if (e.alive) {
          e.flash = Math.max(0, e.flash - dt * 6);
          dummy.position.set(e.x, 0.55 + Math.sin(t * 4 + e.wobble) * 0.1, e.z);
          dummy.rotation.set(0, t * 1.5 + e.wobble, 0);
          // 타입별 실루엣·색: 탱커 크고 어둡게, 슈터 작고 노랗게, 대셔 길쭉+조준 시 부들부들
          let sx = 1;
          let sy = 1;
          let sz = 1;
          palette.tmp.copy(palette.base);
          if (e.type === 'tank') {
            sx = sy = sz = 1.55;
            palette.tmp.multiplyScalar(0.62);
          } else if (e.type === 'shooter') {
            sx = sy = sz = 0.82;
            palette.tmp.lerp(palette.shooterTint, 0.4);
          } else if (e.type === 'dasher') {
            sx = 0.72;
            sz = 0.72;
            sy = 1.28;
            if (e.mode === 1) sy = 1.28 + Math.sin(t * 26) * 0.18;
            if (e.mode === 2) {
              sz = 1.4;
              sy = 0.85;
            }
          }
          const squash = 1 + e.flash * 0.25;
          dummy.scale.set(sx * squash, sy * squash, sz * squash);
          palette.tmp.lerp(palette.white, e.flash);
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

    // ── 투사체 인스턴스
    const sm = shotMeshRef.current;
    if (sm) {
      const shotScale = Math.min(1.9, 1 + (stats.damage / 10 - 1) * 0.3);
      shots.current.forEach((sh, i) => {
        if (sh.alive) {
          dummy.position.set(sh.x, 0.75, sh.z);
          dummy.scale.set(shotScale, shotScale, shotScale);
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

    // ── 슈터 탄막 인스턴스
    const esm = eshotMeshRef.current;
    if (esm) {
      eshots.current.forEach((es, i) => {
        if (es.alive) {
          dummy.position.set(es.x, 0.8, es.z);
          dummy.scale.set(1, 1, 1);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        esm.setMatrixAt(i, dummy.matrix);
      });
      esm.instanceMatrix.needsUpdate = true;
    }

    // ── 파티클 인스턴스
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

    // ── 보석 연출 (빙글빙글 + 둥실둥실, 획득 시 숨김)
    gems.current.forEach((g, i) => {
      const gm = gemRefs.current[i];
      if (!gm) return;
      if (g.taken) {
        gm.visible = false;
      } else {
        gm.visible = true;
        gm.position.set(g.x, 0.85 + Math.sin(t * 2 + i) * 0.14, g.z);
        gm.rotation.y = t * 1.8;
      }
    });

    // ── 카메라 (본체 던전과 같은 탑다운 + 셰이크)
    const cam = frameState.camera;
    const k = 1 - Math.pow(0.001, dt);
    shake.current = Math.max(0, shake.current - dt * 1.6);
    cam.position.lerp(new THREE.Vector3(c.position.x, 15.5, c.position.z + 9.5), k);
    const s2 = shake.current * shake.current;
    cam.position.x += (Math.random() - 0.5) * s2 * 1.6;
    cam.position.z += (Math.random() - 0.5) * s2 * 1.6;
    cam.lookAt(c.position.x, 0, c.position.z);
  });

  const geo = enemyTier;
  return (
    <group>
      <ambientLight intensity={0.62} />
      <directionalLight position={[6, 14, 4]} intensity={1.0} />

      {/* 아레나 바닥 (교대 줄무늬) */}
      {Array.from({ length: 9 }, (_, gy) =>
        Array.from({ length: 9 }, (_, gx) => {
          const wx = (gx - 4) * (ARENA_R / 4.5);
          const wz = (gy - 4) * (ARENA_R / 4.5);
          return (
            <mesh key={`${gx}:${gy}`} position={[wx, -0.15, wz]}>
              <boxGeometry args={[ARENA_R / 4.5, 0.3, ARENA_R / 4.5]} />
              <meshStandardMaterial color={(gx + gy) % 2 === 0 ? '#3a2f55' : '#453a63'} />
            </mesh>
          );
        }),
      )}

      {/* 경계 벽 (네 면) */}
      {[
        [0, ARENA_R + 0.1, ARENA_R * 2 + 1, 0.5],
        [0, -ARENA_R - 0.1, ARENA_R * 2 + 1, 0.5],
        [ARENA_R + 0.1, 0, 0.5, ARENA_R * 2 + 1],
        [-ARENA_R - 0.1, 0, 0.5, ARENA_R * 2 + 1],
      ].map(([px, pz, sx, sz], i) => (
        <mesh key={i} position={[px, 1.1, pz]}>
          <boxGeometry args={[sx, 2.4, sz]} />
          <meshStandardMaterial color="#251c3d" emissive="#3a1f5c" emissiveIntensity={0.3} />
        </mesh>
      ))}

      {/* 몰려오는 몬스터 — 층 티어에 따라 모양·색 변화 (본체와 통일) */}
      <instancedMesh
        ref={enemyMeshRef}
        args={[undefined, undefined, MAX_ENEMIES]}
        frustumCulled={false}
      >
        {geo === 0 && <boxGeometry args={[0.9, 0.9, 0.9]} />}
        {geo === 1 && <octahedronGeometry args={[0.62]} />}
        {geo === 2 && <coneGeometry args={[0.55, 1.05, 6]} />}
        {geo === 3 && <dodecahedronGeometry args={[0.6]} />}
        {geo === 4 && <cylinderGeometry args={[0.42, 0.62, 0.95, 7]} />}
        {geo === 5 && <icosahedronGeometry args={[0.62]} />}
        <meshStandardMaterial emissive={TIER_EMISSIVE[enemyTier]} emissiveIntensity={0.6} />
      </instancedMesh>

      {/* 투사체 */}
      <instancedMesh ref={shotMeshRef} args={[undefined, undefined, MAX_SHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 10, 10]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffb020" emissiveIntensity={1.6} />
      </instancedMesh>

      {/* 슈터 탄막 (빨강) */}
      <instancedMesh ref={eshotMeshRef} args={[undefined, undefined, MAX_ESHOTS]} frustumCulled={false}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshStandardMaterial color="#ff3d5e" emissive="#a01030" emissiveIntensity={1.4} />
      </instancedMesh>

      {/* 파티클 */}
      <instancedMesh
        ref={particleMeshRef}
        args={[undefined, undefined, MAX_PARTICLES]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* 보석 3개 — 무리를 뚫고 몸으로 주워야 능력치업 */}
      {GEM_POS.map((_, i) => (
        <group key={i} ref={(g) => (gemRefs.current[i] = g)}>
          <mesh>
            <octahedronGeometry args={[0.42]} />
            <meshStandardMaterial
              color="#8de0ff"
              emissive="#3aa0ff"
              emissiveIntensity={1.5}
              metalness={0.3}
              roughness={0.15}
            />
          </mesh>
          <pointLight color="#8de0ff" intensity={1.6} distance={5} />
        </group>
      ))}

      {/* 주인공 (아레나 중앙에서 시작) */}
      <group ref={charRef} position={[0, 0, 0]} rotation={[0, Math.PI, 0]}>
        <Hero />
      </group>
    </group>
  );
}
