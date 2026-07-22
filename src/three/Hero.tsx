import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 던전·두 문 달리기·아레나·마을이 같은 주인공을 공유한다 (세계관 통일).
// 내부 주스: 월드 좌표 변화로 이동을 감지해 — 달릴 땐 앞으로 기울며 통통,
// 멈추면 천천히 숨쉬기. 씬 쪽 코드는 그대로 두고 여기 한 곳만 고치면 전부 적용.
export default function Hero() {
  const g = useRef<THREE.Group>(null);
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
  });

  return (
    <group ref={g}>
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
  );
}
