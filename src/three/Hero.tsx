import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 던전·두 문 달리기·아레나·마을이 같은 주인공을 공유한다 (세계관 통일).
// 책 속으로 떨어진 대학생 — 후드티 + 청바지 + 책가방 + 더벅머리 블록 캐릭터.
// 내부 주스: 월드 좌표 변화로 이동을 감지해 — 달릴 땐 팔다리 스윙 + 앞기울임 + 통통,
// 멈추면 천천히 숨쉬기. 씬 쪽 코드는 그대로 두고 여기 한 곳만 고치면 전부 적용.
const HOODIE = '#5aa0ff';
const SLEEVE = '#4c8ce8';
const JEANS = '#31456e';
const SKIN = '#ffd9a8';
const HAIR = '#4a3626';
const BAG = '#8a5a2b';

export default function Hero() {
  const g = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const prev = useRef(new THREE.Vector3());
  const world = useRef(new THREE.Vector3());
  const speed = useRef(0);
  const init = useRef(false);

  useFrame((state, delta) => {
    const gr = g.current;
    if (!gr) return;
    const dt = Math.min(delta, 0.05);
    if (dt <= 0) return;
    const t = state.clock.elapsedTime;
    gr.getWorldPosition(world.current);
    if (!init.current) {
      prev.current.copy(world.current);
      init.current = true;
    }
    const dx = world.current.x - prev.current.x;
    const dz = world.current.z - prev.current.z;
    prev.current.copy(world.current);
    const inst = Math.hypot(dx, dz) / dt;
    // 순간이동(텔레포트·리스폰)의 튀는 값은 무시
    const target = inst > 40 ? speed.current : inst;
    speed.current += (target - speed.current) * Math.min(1, dt * 10);
    const s = Math.min(1, speed.current / 6);

    gr.rotation.x = 0.15 * s; // 달리는 방향으로 살짝 기울임
    gr.position.y = s > 0.05 ? Math.abs(Math.sin(t * 11)) * 0.05 * s : 0;
    const breathe = (1 - s) * Math.sin(t * 2.4) * 0.014; // 정지 시 숨쉬기
    gr.scale.set(1 + breathe * 0.5, 1 + breathe + s * Math.sin(t * 22) * 0.018, 1 + breathe * 0.5);

    // 팔다리 스윙 — 달릴 때 서로 반대 위상으로 (정지 시 자연 감쇠)
    const swing = Math.sin(t * 11) * 0.85 * s;
    if (armL.current) armL.current.rotation.x = swing;
    if (armR.current) armR.current.rotation.x = -swing;
    if (legL.current) legL.current.rotation.x = -swing * 0.9;
    if (legR.current) legR.current.rotation.x = swing * 0.9;
  });

  return (
    <group ref={g}>
      {/* 다리 (청바지) — 골반 피벗에서 스윙 */}
      <group ref={legL} position={[-0.16, 0.38, 0]}>
        <mesh position={[0, -0.19, 0]}>
          <boxGeometry args={[0.24, 0.38, 0.28]} />
          <meshStandardMaterial color={JEANS} />
        </mesh>
      </group>
      <group ref={legR} position={[0.16, 0.38, 0]}>
        <mesh position={[0, -0.19, 0]}>
          <boxGeometry args={[0.24, 0.38, 0.28]} />
          <meshStandardMaterial color={JEANS} />
        </mesh>
      </group>

      {/* 몸통 (후드티) */}
      <mesh position={[0, 0.68, 0]}>
        <boxGeometry args={[0.66, 0.62, 0.42]} />
        <meshStandardMaterial color={HOODIE} />
      </mesh>
      {/* 후드 (목 뒤에 접힌) */}
      <mesh position={[0, 0.95, -0.18]}>
        <boxGeometry args={[0.5, 0.16, 0.16]} />
        <meshStandardMaterial color={SLEEVE} />
      </mesh>

      {/* 팔 (소매) — 어깨 피벗에서 스윙 */}
      <group ref={armL} position={[-0.42, 0.92, 0]}>
        <mesh position={[0, -0.24, 0]}>
          <boxGeometry args={[0.17, 0.48, 0.22]} />
          <meshStandardMaterial color={SLEEVE} />
        </mesh>
        <mesh position={[0, -0.52, 0]}>
          <boxGeometry args={[0.15, 0.1, 0.2]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
      </group>
      <group ref={armR} position={[0.42, 0.92, 0]}>
        <mesh position={[0, -0.24, 0]}>
          <boxGeometry args={[0.17, 0.48, 0.22]} />
          <meshStandardMaterial color={SLEEVE} />
        </mesh>
        <mesh position={[0, -0.52, 0]}>
          <boxGeometry args={[0.15, 0.1, 0.2]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
      </group>

      {/* 책가방 (등 뒤 — 대학생의 증명) */}
      <mesh position={[0, 0.72, -0.32]}>
        <boxGeometry args={[0.44, 0.5, 0.2]} />
        <meshStandardMaterial color={BAG} />
      </mesh>
      <mesh position={[0, 0.85, -0.43]}>
        <boxGeometry args={[0.3, 0.2, 0.04]} />
        <meshStandardMaterial color="#a06a33" />
      </mesh>

      {/* 머리 */}
      <mesh position={[0, 1.28, 0]}>
        <boxGeometry args={[0.52, 0.46, 0.48]} />
        <meshStandardMaterial color={SKIN} />
      </mesh>
      {/* 더벅머리 — 윗머리 + 뒷머리 + 옆머리 */}
      <mesh position={[0, 1.54, -0.02]}>
        <boxGeometry args={[0.56, 0.16, 0.52]} />
        <meshStandardMaterial color={HAIR} />
      </mesh>
      <mesh position={[0, 1.36, -0.22]}>
        <boxGeometry args={[0.56, 0.3, 0.1]} />
        <meshStandardMaterial color={HAIR} />
      </mesh>
      <mesh position={[-0.27, 1.4, 0]}>
        <boxGeometry args={[0.06, 0.22, 0.5]} />
        <meshStandardMaterial color={HAIR} />
      </mesh>
      <mesh position={[0.27, 1.4, 0]}>
        <boxGeometry args={[0.06, 0.22, 0.5]} />
        <meshStandardMaterial color={HAIR} />
      </mesh>
      {/* 앞머리 */}
      <mesh position={[0, 1.5, 0.23]}>
        <boxGeometry args={[0.54, 0.12, 0.06]} />
        <meshStandardMaterial color={HAIR} />
      </mesh>

      {/* 눈 */}
      <mesh position={[-0.11, 1.28, 0.25]}>
        <boxGeometry args={[0.07, 0.09, 0.02]} />
        <meshStandardMaterial color="#2a2333" />
      </mesh>
      <mesh position={[0.11, 1.28, 0.25]}>
        <boxGeometry args={[0.07, 0.09, 0.02]} />
        <meshStandardMaterial color="#2a2333" />
      </mesh>
    </group>
  );
}
