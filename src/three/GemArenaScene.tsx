import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Stats } from '../lib/upgrades';
import { sfx } from '../lib/sound';
import Hero from './Hero';
import {
  useMoveInput,
  useResolveInput,
  RESOLVE_KILLS,
  RESOLVE_DASH_DURATION,
  RESOLVE_DASH_SPEED,
} from './DungeonScene';
import { BlobShadow, getBlobShadowTexture, getFloorTexture } from './fx';

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
  pierce: number; // 남은 관통 횟수 (관통 서표)
  bounce: number; // 남은 벽 반사 횟수 (진화 「종이 표창」 — 아레나 경계에 튕김)
  last: number; // 마지막으로 맞힌 적 인덱스 (관통탄 연속 타격 방지)
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
  lite = false,
  pausedRef,
  onArenaHp,
  onGem,
  onDone,
}: {
  floorNo: number;
  statsRef: React.MutableRefObject<Stats>;
  lite?: boolean; // ⚡가벼움 모드 — 바닥 텍스처 생략
  pausedRef?: React.MutableRefObject<boolean>; // 임시 버프 2택 1이 떠 있는 동안 정지
  onArenaHp: (hp: number, max: number) => void;
  onGem: (count: number) => void;
  onDone: (cleared: boolean, gems: number) => void;
}) {
  const input = useMoveInput(pausedRef);
  // ── 결의(무적 대시) — 던전과 같은 훅·상수 재사용(별개의 ref만 아레나 로컬로 둔다)
  const resolveUiRef = useRef({ n: 0, ready: false });
  const resolveTrigger = useResolveInput(pausedRef, resolveUiRef);
  const resolveActiveRef = useRef(0);
  const resolveDirRef = useRef({ x: 0, z: 1 });
  const charRef = useRef<THREE.Group>(null);
  const enemyMeshRef = useRef<THREE.InstancedMesh>(null);
  const enemyShadowRef = useRef<THREE.InstancedMesh>(null); // 적 발밑 블롭 섀도우
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
    Array.from({ length: MAX_SHOTS }, () => ({ x: 0, z: 0, dx: 0, dz: 0, left: 0, pierce: 0, bounce: 0, last: -1, alive: false })),
  );
  const fanCounter = useRef(0); // 진화 「쏟아지는 문장」 카운터
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
  // ── 임팩트 파문 — 본체 던전과 같은 장치 (카메라 셰이크 대체, 2026-07-27).
  // 아레나는 무리가 몰려오는 곳이라 명중이 더 촘촘하다 = 셰이크였다면 더 심하게 흔들렸다.
  const MAX_RIPPLES = 12;
  const rippleMeshRef = useRef<THREE.InstancedMesh>(null);
  const ripples = useRef(
    Array.from({ length: MAX_RIPPLES }, () => ({
      x: 0, z: 0, ttl: 0, max: 1, r0: 0.4, r1: 1.6, alive: false,
      color: new THREE.Color(),
    })),
  );
  const rippleTmp = useMemo(() => new THREE.Color(), []);
  const ripple = (x: number, z: number, power: number, color = '#ffd8a8') => {
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
        // 봇이 던전과 같은 방식으로 회피·길찾기를 하려면 좌표가 필요하다 (본체 __d100과 같은 형식)
        eshots: eshots.current.filter((sh) => sh.alive).map((sh) => [sh.x, sh.z, sh.dx, sh.dz]),
        enemiesPos: enemies.current.filter((e) => e.alive).map((e) => [e.x, e.z]),
        radius: ARENA_R,
        cleared: clearT.current >= 0,
        resolve: { n: resolveUiRef.current.n, ready: resolveUiRef.current.ready, active: +resolveActiveRef.current.toFixed(2) },
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
    // 임시 버프 2택 1이 떠 있는 동안은 무리도 탄막도 멈춘다 (선택하는 사이 맞으면 억울하다)
    if (pausedRef?.current) return;
    const bound = ARENA_R - 0.6;

    if (clearT.current >= 0) {
      // 클리어 축하 — 잠깐 색종이 뿌리고 종료
      clearT.current += dt;
      if (clearT.current > 0.9 && !doneCalled.current) {
        doneCalled.current = true;
        onDone(true, 3);
      }
    } else if (!doneCalled.current) {
      // ── 결의(무적 대시) 발동 — 던전과 동일한 규칙, 경계는 아레나 클램프를 그대로 쓴다.
      if (resolveActiveRef.current > 0) resolveActiveRef.current = Math.max(0, resolveActiveRef.current - dt);
      if (resolveUiRef.current.ready && resolveTrigger.current) {
        resolveTrigger.current = false;
        resolveUiRef.current = { n: 0, ready: false };
        resolveActiveRef.current = RESOLVE_DASH_DURATION;
        const dd = input.current;
        const dmag = Math.hypot(dd.x, dd.z);
        resolveDirRef.current =
          dmag > 0.01
            ? { x: dd.x / dmag, z: dd.z / dmag }
            : { x: Math.sin(c.rotation.y), z: Math.cos(c.rotation.y) };
        sfx.resolve();
        burst(c.position.x, 0.7, c.position.z, '#ffd166', 18, 2.6);
      }
      const dashingNow = resolveActiveRef.current > 0;

      // ── 이동 (아레나 경계로 클램프) — 대시 중엔 입력 대신 고정 방향으로 고속 돌진
      const d = input.current;
      const mag = Math.hypot(d.x, d.z);
      if (dashingNow) {
        const rd = resolveDirRef.current;
        c.position.x = THREE.MathUtils.clamp(c.position.x + rd.x * RESOLVE_DASH_SPEED * dt, -bound, bound);
        c.position.z = THREE.MathUtils.clamp(c.position.z + rd.z * RESOLVE_DASH_SPEED * dt, -bound, bound);
        c.rotation.y = Math.atan2(rd.x, rd.z);
        c.position.y = 0.05;
      } else if (mag > 0.01) {
        c.position.x = THREE.MathUtils.clamp(c.position.x + d.x * stats.speed * dt, -bound, bound);
        c.position.z = THREE.MathUtils.clamp(c.position.z + d.z * stats.speed * dt, -bound, bound);
        c.rotation.y = Math.atan2(d.x, d.z);
        c.position.y = Math.abs(Math.sin(t * 10)) * 0.08;
      } else {
        c.position.y = 0;
      }

      // ── 자동 조준 발사 (본체와 동일한 감각) — 대시 중엔 정지
      if (dashingNow) fireTimer.current = Math.max(fireTimer.current, 0.02);
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
          // 진화 「쏟아지는 문장」 — N번째 공격은 부채꼴 9연발 (본체와 동일)
          fanCounter.current++;
          const isFan = stats.fanEvery > 0 && fanCounter.current % stats.fanEvery === 0;
          const nShots = isFan ? 9 : stats.shots;
          const spread = isFan ? 0.24 : 0.16;
          for (let s = 0; s < nShots; s++) {
            const slot = shots.current.find((sh) => !sh.alive);
            if (!slot) break;
            const ang = base + (s - (nShots - 1) / 2) * spread;
            slot.x = c.position.x;
            slot.z = c.position.z;
            slot.dx = Math.sin(ang);
            slot.dz = Math.cos(ang);
            slot.left = stats.range;
            slot.pierce = stats.pierce;
            slot.bounce = stats.bounce;
            slot.last = -1;
            slot.alive = true;
          }
          if (isFan) {
            burst(c.position.x, 0.85, c.position.z, '#ffd166', 8, 1.8);
            sfx.pass();
          }
          fireTimer.current = 1 / stats.fireRate;
        }
      }

      // ── 처치 공통 — 흡혈은 아레나 체력을 회복, 폭발 구슬은 무리에 특히 강력
      const killEnemy = (e: AEnemy, chain: boolean) => {
        e.alive = false;
        burst(e.x, 0.7, e.z, palette.base.getStyle(), 12, 2.0);
        ripple(e.x, e.z, 0.4, '#ffb020');
        sfx.kill();
        if (stats.lifesteal > 0 && hp.current > 0) {
          hp.current = Math.min(ARENA_MAX_HP, hp.current + stats.lifesteal);
          onArenaHp(hp.current, ARENA_MAX_HP);
        }
        // 결의 게이지 — 던전과 동일하게 처치마다 1씩(연쇄 폭발 포함)
        const rs = resolveUiRef.current;
        if (!rs.ready && rs.n < RESOLVE_KILLS) {
          rs.n++;
          if (rs.n >= RESOLVE_KILLS) {
            rs.ready = true;
            sfx.resolveReady();
          }
        }
        if (chain && stats.boom > 0) {
          burst(e.x, 0.9, e.z, '#ff9a3d', 12, 2.2);
          for (const e2 of enemies.current) {
            if (!e2.alive || e2 === e) continue;
            if (Math.hypot(e2.x - e.x, e2.z - e.z) < 2.4) {
              e2.hp -= stats.boom;
              e2.flash = 1;
              if (e2.hp <= 0) killEnemy(e2, false);
            }
          }
        }
      };

      // ── 투사체 (명중 → 번쩍 + 스파크 + 넉백 — 치명타·관통·탄속 반영)
      const shotSpd = SHOT_SPEED * stats.shotSpeed;
      for (const sh of shots.current) {
        if (!sh.alive) continue;
        sh.x += sh.dx * shotSpd * dt;
        sh.z += sh.dz * shotSpd * dt;
        sh.left -= shotSpd * dt;
        if (sh.left <= 0) {
          sh.alive = false;
          continue;
        }
        // 진화 「종이 표창」 — 아레나 경계에 한 번 튕긴다
        if (Math.abs(sh.x) > ARENA_R || Math.abs(sh.z) > ARENA_R) {
          if (sh.bounce > 0) {
            sh.bounce -= 1;
            if (Math.abs(sh.x) > ARENA_R) sh.dx = -sh.dx;
            if (Math.abs(sh.z) > ARENA_R) sh.dz = -sh.dz;
            sh.x = THREE.MathUtils.clamp(sh.x, -ARENA_R, ARENA_R);
            sh.z = THREE.MathUtils.clamp(sh.z, -ARENA_R, ARENA_R);
            burst(sh.x, 0.75, sh.z, '#f4efe0', 2, 0.8);
          } else {
            sh.alive = false;
            continue;
          }
        }
        for (let ei = 0; ei < enemies.current.length; ei++) {
          const e = enemies.current[ei];
          if (!e.alive) continue;
          if (ei === sh.last) continue;
          if (Math.hypot(e.x - sh.x, e.z - sh.z) < 0.62) {
            const crit = stats.crit > 0 && Math.random() < stats.crit;
            const adm = stats.damage * (crit ? 2 : 1);
            e.hp -= adm;
            e.flash = 1;
            if (sh.pierce > 0) {
              sh.pierce -= 1;
              sh.last = ei;
            } else {
              sh.alive = false;
            }
            if (crit) sfx.crit();
            else sfx.hit();
            burst(e.x, 0.7, e.z, crit ? '#ff8a3d' : '#ffe08a', 4, 1.4);
            // 진화 「마침표」 — 치명타 대폭발 (무리 상대라 특히 강력)
            if (crit && stats.critBoom > 0) {
              burst(e.x, 0.9, e.z, '#ff9a3d', 16, 2.4);
              ripple(e.x, e.z, 1.0, '#ff9a3d');
              for (const e2 of enemies.current) {
                if (!e2.alive || e2 === e) continue;
                if (Math.hypot(e2.x - e.x, e2.z - e.z) < 2.6) {
                  e2.hp -= adm * 0.8;
                  e2.flash = 1;
                  if (e2.hp <= 0) killEnemy(e2, false);
                }
              }
            }
            if (e.type !== 'tank') {
              // 탱커는 넉백 면역 — 밀어내기 배율 반영
              e.x = THREE.MathUtils.clamp(e.x + sh.dx * 0.4 * stats.knock, -bound, bound);
              e.z = THREE.MathUtils.clamp(e.z + sh.dz * 0.4 * stats.knock, -bound, bound);
            }
            if (e.hp <= 0) killEnemy(e, true);
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
        // 결의 무적 대시 — 단일 함수라 던전과 마찬가지로 가드도 한 곳에만 둔다
        if (resolveActiveRef.current > 0) {
          burst(c.position.x, 0.9, c.position.z, '#ffd166', 5, 1.2);
          return;
        }
        // 잔상 회피·단단한 표지 — 본체와 동일하게 아레나에서도 적용
        if (stats.dodge > 0 && Math.random() < stats.dodge) {
          burst(c.position.x, 0.9, c.position.z, '#9fe8ff', 5, 1.2);
          return;
        }
        const applied = Math.max(1, Math.round(dmg * (1 - stats.armor)));
        hp.current = Math.max(0, hp.current - applied);
        onArenaHp(hp.current, ARENA_MAX_HP);
        ripple(c.position.x, c.position.z, 0.6, '#ff5d6e');
        burst(c.position.x, 0.8, c.position.z, '#ff4d5e', 6, 1.6);
        sfx.hurt();
        // 진화 「단단한 장정」 — 맞는 순간 충격파 (본체와 동일)
        if (stats.shockwave > 0) {
          burst(c.position.x, 0.6, c.position.z, '#ffd166', 14, 2.6);
          for (const e2 of enemies.current) {
            if (!e2.alive) continue;
            const dd = Math.hypot(e2.x - c.position.x, e2.z - c.position.z);
            if (dd < 3.2) {
              e2.hp -= 10 + stats.thorns;
              e2.flash = 1;
              if (e2.type !== 'tank') {
                e2.x = THREE.MathUtils.clamp(e2.x + ((e2.x - c.position.x) / (dd || 1)) * 2.2, -bound, bound);
                e2.z = THREE.MathUtils.clamp(e2.z + ((e2.z - c.position.z) / (dd || 1)) * 2.2, -bound, bound);
              }
              if (e2.hp <= 0) killEnemy(e2, true);
            }
          }
        }
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
          // 가시 문장 — 접촉한 적에게 반사 피해
          if (stats.thorns > 0) {
            e.hp -= stats.thorns;
            e.flash = 1;
            if (e.hp <= 0) killEnemy(e, true);
          }
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
          ripple(g.x, g.z, 1.0, '#8de0ff');
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
    const esh = enemyShadowRef.current;
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
        // 발밑 블롭 섀도우 (죽은 적은 위 히든 매트릭스 재사용)
        if (esh) {
          if (e.alive) {
            const ss = e.type === 'tank' ? 1.5 : e.type === 'shooter' ? 0.85 : 1;
            dummy.position.set(e.x, 0.02, e.z);
            dummy.rotation.set(-Math.PI / 2, 0, 0);
            dummy.scale.set(ss, ss, 1);
            dummy.updateMatrix();
          }
          esh.setMatrixAt(i, dummy.matrix);
        }
      });
      em.instanceMatrix.needsUpdate = true;
      if (em.instanceColor) em.instanceColor.needsUpdate = true;
      if (esh) esh.instanceMatrix.needsUpdate = true;
    }

    // ── 투사체 인스턴스 (진행 방향으로 늘여 궤적감)
    const sm = shotMeshRef.current;
    if (sm) {
      const shotScale = Math.min(1.9, 1 + (stats.damage / 10 - 1) * 0.3);
      shots.current.forEach((sh, i) => {
        if (sh.alive) {
          dummy.position.set(sh.x, 0.75, sh.z);
          dummy.rotation.set(0, Math.atan2(sh.dx, sh.dz), 0);
          dummy.scale.set(shotScale, shotScale, shotScale * 2.1);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        sm.setMatrixAt(i, dummy.matrix);
      });
      sm.instanceMatrix.needsUpdate = true;
    }

    // ── 슈터 탄막 인스턴스 (진행 방향으로 살짝 늘임)
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

    // ── 임팩트 파문 (본체 던전과 같은 규칙 — 맞은 자리에서 퍼졌다 사그라든다)
    const rm = rippleMeshRef.current;
    if (rm) {
      ripples.current.forEach((rp, i) => {
        if (rp.alive) {
          rp.ttl -= dt;
          if (rp.ttl <= 0) rp.alive = false;
        }
        if (rp.alive) {
          const kk = rp.ttl / rp.max;
          const r = rp.r0 + (rp.r1 - rp.r0) * (1 - kk * kk);
          dummy.position.set(rp.x, 0.07, rp.z);
          dummy.rotation.set(-Math.PI / 2, 0, 0);
          dummy.scale.set(r, r, 1);
          rm.setColorAt(i, rippleTmp.copy(rp.color).multiplyScalar(kk * kk));
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

    // ── 카메라 (본체 던전과 같은 탑다운 — **흔들지 않는다**, 2026-07-27)
    const cam = frameState.camera;
    const k = 1 - Math.pow(0.001, dt);
    cam.position.lerp(new THREE.Vector3(c.position.x, 15.5, c.position.z + 9.5), k);
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
              {lite ? (
                <meshStandardMaterial key="lite" color={(gx + gy) % 2 === 0 ? '#3a2f55' : '#453a63'} />
              ) : (
                <meshStandardMaterial
                  key="high"
                  color={(gx + gy) % 2 === 0 ? '#3a2f55' : '#453a63'}
                  map={getFloorTexture()}
                />
              )}
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

      {/* 임팩트 파문 — 카메라 셰이크 대신 바닥에 새기는 충격 링 */}
      <instancedMesh
        ref={rippleMeshRef}
        args={[undefined, undefined, MAX_RIPPLES]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.82, 1, 30]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
      </instancedMesh>

      {/* 파티클 — additive로 빛나는 불꽃 */}
      <instancedMesh
        ref={particleMeshRef}
        args={[undefined, undefined, MAX_PARTICLES]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} blending={THREE.AdditiveBlending} transparent depthWrite={false} />
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

      {/* 적 발밑 블롭 섀도우 */}
      <instancedMesh ref={enemyShadowRef} args={[undefined, undefined, MAX_ENEMIES]} frustumCulled={false}>
        <planeGeometry args={[1.35, 1.35]} />
        <meshBasicMaterial map={getBlobShadowTexture()} transparent depthWrite={false} />
      </instancedMesh>

      {/* 주인공 (아레나 중앙에서 시작) — 아레나는 몬스터 던전 전용이라 모험가 모습 */}
      <group ref={charRef} position={[0, 0, 0]} rotation={[0, Math.PI, 0]}>
        <BlobShadow />
        <Hero variant="monster" />
      </group>
    </group>
  );
}
