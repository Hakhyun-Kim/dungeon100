import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Quiz } from '../lib/quiz';
import { sfx } from '../lib/sound';
import Hero, { type HeroVariant } from './Hero';
import { BlobShadow } from './fx';
import { makeTextTexture } from './textTexture';

// 보물상자 미니게임 — 두 문 러너 본편의 재현.
// 자동으로 달리는 주인공을 좌우로 조종해 "정답이 적힌 문"을 몸으로 열어야 아이템을 얻는다.
// 벽(문 사이 포함)은 막혀 있어 반드시 한쪽 문을 골라야 한다.
const RUN_START = 30; // 출발 z (문은 z=0)
const DOOR_X = 2.6; // 문 중심 좌우 오프셋
const DOOR_W = 2.7;
const DOOR_H = 3.6;
const GATE_H = 5.4;
const TRACK_W = 11;
const RUN_SPEED = 9.5;
const STEER_SPEED = 7.5;
const MAX_CONFETTI = 40;

interface Confetti {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ttl: number;
  max: number;
  alive: boolean;
  color: THREE.Color;
}

export default function DoorRunScene({
  quiz,
  heroVariant,
  onDone,
}: {
  quiz: Quiz;
  heroVariant?: HeroVariant;
  onDone: (ok: boolean) => void;
}) {
  const steer = useSteer();
  const charRef = useRef<THREE.Group>(null);
  const leftDoorRef = useRef<THREE.Group>(null);
  const rightDoorRef = useRef<THREE.Group>(null);
  const hintLightRef = useRef<THREE.PointLight>(null);
  const confettiMeshRef = useRef<THREE.InstancedMesh>(null);
  const state = useRef<{ mode: 'run' | 'pass' | 'crash'; timer: number; doorOpen: number }>({
    mode: 'run',
    timer: 0,
    doorOpen: 0,
  });
  const doneCalled = useRef(false);
  const confetti = useRef<Confetti[]>(
    Array.from({ length: MAX_CONFETTI }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ttl: 0, max: 1, alive: false,
      color: new THREE.Color(),
    })),
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const textures = useMemo(
    () => ({
      board: makeTextTexture(quiz.q, { width: 1024, height: 256, maxFontPx: 150 }),
      left: makeTextTexture(quiz.answers[0], { width: 256, height: 256 }),
      right: makeTextTexture(quiz.answers[1], { width: 256, height: 256 }),
    }),
    [quiz],
  );
  useEffect(
    () => () => {
      textures.board.dispose();
      textures.left.dispose();
      textures.right.dispose();
    },
    [textures],
  );

  // 개발 검증용 훅 (프로덕션 빌드에서는 제외)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__d100run = {
      place: (x: number, z: number) => {
        const c = charRef.current;
        if (c) {
          c.position.x = x;
          c.position.z = z;
        }
      },
      state: () => ({
        mode: state.current.mode,
        char: charRef.current ? [charRef.current.position.x, charRef.current.position.z] : null,
        q: quiz.q,
        correct: quiz.correct,
        doorX: quiz.correct === 0 ? -DOOR_X : DOOR_X,
      }),
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__d100run;
    };
  }, [quiz]);

  const burstConfetti = (x: number, y: number, z: number) => {
    const colors = ['#ffd166', '#8f6bff', '#5aa0ff', '#ff5d7e', '#7be0a0'];
    confetti.current.forEach((pt, i) => {
      const ang = (i / MAX_CONFETTI) * Math.PI * 2;
      pt.x = x;
      pt.y = y;
      pt.z = z;
      pt.vx = Math.sin(ang) * (1 + Math.random() * 2);
      pt.vz = Math.cos(ang) * (1 + Math.random() * 2);
      pt.vy = 3.5 + Math.random() * 3;
      pt.max = 0.8 + Math.random() * 0.5;
      pt.ttl = pt.max;
      pt.color.set(colors[i % colors.length]);
      pt.alive = true;
    });
  };

  useFrame((frameState, delta) => {
    const devWin = window as unknown as Record<string, unknown>;
    const fixdt = import.meta.env.DEV ? Number(devWin.__d100fixdt) || 0 : 0;
    const speedScale = (import.meta.env.DEV && Number(devWin.__d100speed)) || 1;
    const dt = fixdt > 0 ? fixdt : Math.min(delta, 0.05) * speedScale;
    const t = frameState.clock.elapsedTime;
    const s = state.current;
    const c = charRef.current;
    if (!c) return;

    if (s.mode === 'run') {
      c.position.z -= RUN_SPEED * dt;
      c.position.x = THREE.MathUtils.clamp(
        c.position.x + steer.current * STEER_SPEED * dt,
        -TRACK_W / 2 + 0.6,
        TRACK_W / 2 - 0.6,
      );
      c.position.y = Math.abs(Math.sin(t * 11)) * 0.12;

      if (c.position.z <= 0.55) {
        const x = c.position.x;
        let chosen: 0 | 1 | null = null;
        if (Math.abs(x + DOOR_X) < DOOR_W / 2 - 0.1) chosen = 0;
        else if (Math.abs(x - DOOR_X) < DOOR_W / 2 - 0.1) chosen = 1;
        if (chosen === null) {
          c.position.z = 0.55; // 벽에 막힘 — 좌우로 움직여 문을 찾아야 함
        } else {
          s.timer = 0;
          if (chosen === quiz.correct) {
            s.mode = 'pass';
            sfx.pass();
            burstConfetti(c.position.x, 1.2, c.position.z - 1);
          } else {
            s.mode = 'crash';
            sfx.crash();
          }
        }
      }
    } else if (s.mode === 'pass') {
      s.timer += dt;
      s.doorOpen = Math.min(1, s.doorOpen + dt * 4);
      c.position.z -= RUN_SPEED * 0.7 * dt;
      c.position.y = Math.abs(Math.sin(t * 11)) * 0.12;
      if (s.timer > 1.0 && !doneCalled.current) {
        doneCalled.current = true;
        onDone(true);
      }
    } else {
      // crash — 뒤로 벌러덩 + 정답 문이 초록빛으로 깜빡이며 알려줌
      s.timer += dt;
      c.rotation.x = Math.max(-Math.PI / 2, c.rotation.x - dt * 4);
      c.position.z += dt * 2.0;
      if (s.timer > 1.6 && !doneCalled.current) {
        doneCalled.current = true;
        onDone(false);
      }
    }

    // 정답 문 열림 (통과 시)
    const open = s.doorOpen * 1.9;
    if (leftDoorRef.current) leftDoorRef.current.rotation.y = quiz.correct === 0 ? -open : 0;
    if (rightDoorRef.current) rightDoorRef.current.rotation.y = quiz.correct === 1 ? open : 0;

    // crash 시 정답 문 강조
    if (hintLightRef.current) {
      hintLightRef.current.intensity = s.mode === 'crash' ? 2.5 + Math.sin(t * 10) * 1.5 : 0;
    }

    // 색종이
    const cm = confettiMeshRef.current;
    if (cm) {
      confetti.current.forEach((pt, i) => {
        if (pt.alive) {
          pt.ttl -= dt;
          if (pt.ttl <= 0) pt.alive = false;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.z += pt.vz * dt;
          pt.vy -= 8 * dt;
          const sc = 0.12 * (pt.ttl / pt.max);
          dummy.position.set(pt.x, Math.max(0.05, pt.y), pt.z);
          dummy.rotation.set(pt.ttl * 6, pt.ttl * 9, 0);
          dummy.scale.set(sc, sc, sc);
          cm.setColorAt(i, pt.color);
        } else {
          dummy.position.set(0, -10, 0);
          dummy.scale.set(0.0001, 0.0001, 0.0001);
        }
        dummy.updateMatrix();
        cm.setMatrixAt(i, dummy.matrix);
      });
      cm.instanceMatrix.needsUpdate = true;
      if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
    }

    // 카메라 — 주인공 등 뒤에서 추적 (두 문 러너 감각)
    const cam = frameState.camera;
    const k = 1 - Math.pow(0.001, dt);
    cam.position.lerp(new THREE.Vector3(c.position.x * 0.55, 4.4, c.position.z + 7.2), k);
    cam.lookAt(c.position.x * 0.4, 1.4, c.position.z - 5);
  });

  const sideWallX = TRACK_W / 2 + 0.15;
  const segW = TRACK_W / 2 - DOOR_X - DOOR_W / 2; // 문 바깥쪽 벽 폭
  const midW = DOOR_X * 2 - DOOR_W; // 문 사이 벽 폭

  return (
    <group>
      <ambientLight intensity={0.75} />
      <directionalLight position={[5, 12, 8]} intensity={1.1} />

      {/* 트랙 바닥 (교대 줄무늬) */}
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[0, -0.15, RUN_START - 2 - i * 4 + 2]}>
          <boxGeometry args={[TRACK_W, 0.3, 4]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#3a2f55' : '#453a63'} />
        </mesh>
      ))}

      {/* 유리 옆벽 */}
      <mesh position={[-sideWallX, 1.2, RUN_START / 2 - 4]}>
        <boxGeometry args={[0.3, 2.4, RUN_START + 14]} />
        <meshStandardMaterial color="#9fd8ff" transparent opacity={0.22} />
      </mesh>
      <mesh position={[sideWallX, 1.2, RUN_START / 2 - 4]}>
        <boxGeometry args={[0.3, 2.4, RUN_START + 14]} />
        <meshStandardMaterial color="#9fd8ff" transparent opacity={0.22} />
      </mesh>

      {/* 보라 게이트 벽 (문 자리만 뚫림) */}
      <mesh position={[-(DOOR_X + DOOR_W / 2 + segW / 2), GATE_H / 2, 0]}>
        <boxGeometry args={[segW, GATE_H, 0.5]} />
        <meshStandardMaterial color="#6a4fd0" />
      </mesh>
      <mesh position={[DOOR_X + DOOR_W / 2 + segW / 2, GATE_H / 2, 0]}>
        <boxGeometry args={[segW, GATE_H, 0.5]} />
        <meshStandardMaterial color="#6a4fd0" />
      </mesh>
      <mesh position={[0, GATE_H / 2, 0]}>
        <boxGeometry args={[midW, GATE_H, 0.5]} />
        <meshStandardMaterial color="#6a4fd0" />
      </mesh>
      <mesh position={[-DOOR_X, DOOR_H + (GATE_H - DOOR_H) / 2, 0]}>
        <boxGeometry args={[DOOR_W, GATE_H - DOOR_H, 0.5]} />
        <meshStandardMaterial color="#6a4fd0" />
      </mesh>
      <mesh position={[DOOR_X, DOOR_H + (GATE_H - DOOR_H) / 2, 0]}>
        <boxGeometry args={[DOOR_W, GATE_H - DOOR_H, 0.5]} />
        <meshStandardMaterial color="#6a4fd0" />
      </mesh>

      {/* 문짝 (경첩 그룹 — 정답 문이 열린다) */}
      <group ref={leftDoorRef} position={[-DOOR_X - DOOR_W / 2, 0, 0]}>
        <mesh position={[DOOR_W / 2, DOOR_H / 2, 0.05]}>
          <boxGeometry args={[DOOR_W - 0.12, DOOR_H, 0.18]} />
          <meshStandardMaterial color="#8f6bff" emissive="#4a2f8f" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[DOOR_W / 2, DOOR_H * 0.58, 0.16]}>
          <planeGeometry args={[1.9, 1.9]} />
          <meshBasicMaterial map={textures.left} transparent toneMapped={false} />
        </mesh>
      </group>
      <group ref={rightDoorRef} position={[DOOR_X + DOOR_W / 2, 0, 0]}>
        <mesh position={[-DOOR_W / 2, DOOR_H / 2, 0.05]}>
          <boxGeometry args={[DOOR_W - 0.12, DOOR_H, 0.18]} />
          <meshStandardMaterial color="#8f6bff" emissive="#4a2f8f" emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[-DOOR_W / 2, DOOR_H * 0.58, 0.16]}>
          <planeGeometry args={[1.9, 1.9]} />
          <meshBasicMaterial map={textures.right} transparent toneMapped={false} />
        </mesh>
      </group>

      {/* crash 시 정답 문 위치를 알려주는 초록 불빛 */}
      <pointLight
        ref={hintLightRef}
        color="#7be0a0"
        intensity={0}
        distance={8}
        position={[quiz.correct === 0 ? -DOOR_X : DOOR_X, DOOR_H / 2, 1.2]}
      />

      {/* 문제판 */}
      <group position={[0, GATE_H + 1.5, -0.2]}>
        <mesh>
          <boxGeometry args={[8.6, 2.4, 0.2]} />
          <meshStandardMaterial color="#241c3d" />
        </mesh>
        <mesh position={[0, 0, 0.14]}>
          <planeGeometry args={[8.2, 2.05]} />
          <meshBasicMaterial map={textures.board} transparent toneMapped={false} />
        </mesh>
      </group>

      {/* 색종이 */}
      <instancedMesh ref={confettiMeshRef} args={[undefined, undefined, MAX_CONFETTI]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* 주인공 — 던전과 같은 캐릭터 (등을 보이며 -z로 달림) */}
      <group ref={charRef} position={[0, 0, RUN_START]} rotation={[0, Math.PI, 0]}>
        <BlobShadow />
        <Hero variant={heroVariant} />
      </group>
    </group>
  );
}

// 두 문 러너식 조작: 화면 왼쪽/오른쪽 꾹 누르기 또는 ←/→·A/D
// 터치 기기(coarse pointer)에서는 좌/우 존 인디케이터(◀▶)를 띄우고 누른 쪽을 밝힌다.
function useSteer() {
  const dir = useRef(0);
  useEffect(() => {
    const keys = new Set<string>();
    let touch = 0;

    // 터치 기기에만 좌/우 존 표시 (버튼이 아니라 인디케이터 — 실제 입력은 화면 반쪽 어디든)
    let zoneL: HTMLDivElement | null = null;
    let zoneR: HTMLDivElement | null = null;
    if (window.matchMedia('(pointer: coarse)').matches) {
      zoneL = document.createElement('div');
      zoneL.className = 'steer-zone left';
      zoneL.textContent = '◀';
      zoneR = document.createElement('div');
      zoneR.className = 'steer-zone right';
      zoneR.textContent = '▶';
      document.body.append(zoneL, zoneR);
    }

    const update = () => {
      let x = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (x === 0) x = touch;
      dir.current = x;
      zoneL?.classList.toggle('active', x < 0);
      zoneR?.classList.toggle('active', x > 0);
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
      if ((e.target as HTMLElement).closest('button')) return;
      touch = e.clientX < window.innerWidth / 2 ? -1 : 1;
      update();
    };
    const pmove = (e: PointerEvent) => {
      if (!e.isPrimary || touch === 0) return;
      touch = e.clientX < window.innerWidth / 2 ? -1 : 1;
      update();
    };
    const pup = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      touch = 0;
      update();
    };
    const blur = () => {
      keys.clear();
      touch = 0;
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
      zoneL?.remove();
      zoneR?.remove();
    };
  }, []);
  return dir;
}
