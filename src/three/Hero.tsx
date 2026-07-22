import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// 던전·두 문 달리기·아레나·마을이 같은 주인공을 공유한다 (세계관 통일).
// 책이 주인공을 "그 장에 맞는 모습"으로 그린다 — 던전 종류(선택)에 따라 다른 모습:
//   🎒 kids   = 초등학생 (노란 모자·빨간 책가방·반바지, 조금 작음)
//   🧠 adult  = 대학생 (후드티·청바지·갈색 책가방·더벅머리) — 기본
//   👹 monster = 모험가 (가죽옷·붉은 머리띠·등에 검)
// 내부 주스: 월드 좌표 변화로 이동을 감지해 — 달릴 땐 팔다리 스윙 + 앞기울임 + 통통,
// 멈추면 천천히 숨쉬기. 씬 쪽 코드는 그대로 두고 여기 한 곳만 고치면 전부 적용.
export type HeroVariant = 'kids' | 'adult' | 'monster';

const SKIN = '#ffd9a8';
const EYE = '#2a2333';

// 옷·머리 팔레트 (변신해도 '같은 사람'이게 피부·눈은 고정)
const P = {
  kids: { top: '#ff8a5c', sleeve: '#e87848', bottom: '#31456e', hair: '#4a3626', bag: '#d84a4a' },
  adult: { top: '#5aa0ff', sleeve: '#4c8ce8', bottom: '#31456e', hair: '#4a3626', bag: '#8a5a2b' },
  monster: { top: '#7a4a2f', sleeve: '#633c26', bottom: '#3c2f26', hair: '#2f2622', bag: '#8a5a2b' },
} as const;

export default function Hero({ variant = 'adult' }: { variant?: HeroVariant }) {
  const g = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const prev = useRef(new THREE.Vector3());
  const world = useRef(new THREE.Vector3());
  const speed = useRef(0);
  const init = useRef(false);
  const c = P[variant];
  const kid = variant === 'kids';

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
    // 초등학생은 한 뼘 작게 (겉 그룹 고정 스케일 — 안쪽 그룹은 애니메이션이 매 프레임 스케일을 잡음)
    <group scale={kid ? 0.84 : 1}>
      <group ref={g}>
        {/* 다리 — 골반 피벗에서 스윙 (초등학생은 반바지 + 맨다리) */}
        <group ref={legL} position={[-0.16, 0.38, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[0.24, kid ? 0.2 : 0.38, 0.28]} />
            <meshStandardMaterial color={c.bottom} />
          </mesh>
          {kid && (
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.2, 0.16, 0.24]} />
              <meshStandardMaterial color={SKIN} />
            </mesh>
          )}
        </group>
        <group ref={legR} position={[0.16, 0.38, 0]}>
          <mesh position={[0, -0.12, 0]}>
            <boxGeometry args={[0.24, kid ? 0.2 : 0.38, 0.28]} />
            <meshStandardMaterial color={c.bottom} />
          </mesh>
          {kid && (
            <mesh position={[0, -0.29, 0]}>
              <boxGeometry args={[0.2, 0.16, 0.24]} />
              <meshStandardMaterial color={SKIN} />
            </mesh>
          )}
        </group>

        {/* 몸통 */}
        <mesh position={[0, 0.68, 0]}>
          <boxGeometry args={[0.66, 0.62, 0.42]} />
          <meshStandardMaterial color={c.top} />
        </mesh>
        {variant === 'adult' && (
          // 후드 (목 뒤에 접힌)
          <mesh position={[0, 0.95, -0.18]}>
            <boxGeometry args={[0.5, 0.16, 0.16]} />
            <meshStandardMaterial color={c.sleeve} />
          </mesh>
        )}
        {variant === 'monster' && (
          // 가죽 벨트
          <mesh position={[0, 0.46, 0]}>
            <boxGeometry args={[0.68, 0.1, 0.44]} />
            <meshStandardMaterial color="#2f2018" />
          </mesh>
        )}

        {/* 팔 — 어깨 피벗에서 스윙 */}
        <group ref={armL} position={[-0.42, 0.92, 0]}>
          <mesh position={[0, -0.24, 0]}>
            <boxGeometry args={[0.17, 0.48, 0.22]} />
            <meshStandardMaterial color={c.sleeve} />
          </mesh>
          <mesh position={[0, -0.52, 0]}>
            <boxGeometry args={[0.15, 0.1, 0.2]} />
            <meshStandardMaterial color={SKIN} />
          </mesh>
        </group>
        <group ref={armR} position={[0.42, 0.92, 0]}>
          <mesh position={[0, -0.24, 0]}>
            <boxGeometry args={[0.17, 0.48, 0.22]} />
            <meshStandardMaterial color={c.sleeve} />
          </mesh>
          <mesh position={[0, -0.52, 0]}>
            <boxGeometry args={[0.15, 0.1, 0.2]} />
            <meshStandardMaterial color={SKIN} />
          </mesh>
        </group>

        {/* 등 — 책가방(초등학생 빨강 / 대학생 갈색) 또는 검(모험가) */}
        {variant !== 'monster' ? (
          <>
            <mesh position={[0, 0.72, -0.32]}>
              <boxGeometry args={[0.44, 0.5, 0.2]} />
              <meshStandardMaterial color={c.bag} />
            </mesh>
            <mesh position={[0, 0.85, -0.43]}>
              <boxGeometry args={[0.3, 0.2, 0.04]} />
              <meshStandardMaterial color={kid ? '#e87070' : '#a06a33'} />
            </mesh>
          </>
        ) : (
          <group position={[0.12, 0.95, -0.28]} rotation={[0, 0, -0.6]}>
            <mesh position={[0, 0.3, 0]}>
              <boxGeometry args={[0.08, 0.7, 0.04]} />
              <meshStandardMaterial color="#c8d0da" metalness={0.5} roughness={0.35} />
            </mesh>
            <mesh position={[0, -0.12, 0]}>
              <boxGeometry args={[0.2, 0.06, 0.06]} />
              <meshStandardMaterial color="#5a4028" />
            </mesh>
            <mesh position={[0, -0.24, 0]}>
              <boxGeometry args={[0.07, 0.18, 0.07]} />
              <meshStandardMaterial color="#3c2a1a" />
            </mesh>
          </group>
        )}

        {/* 머리 */}
        <mesh position={[0, 1.28, 0]}>
          <boxGeometry args={[0.52, 0.46, 0.48]} />
          <meshStandardMaterial color={SKIN} />
        </mesh>
        {/* 머리카락 — 윗/뒷/옆/앞 (초등학생은 노란 모자가 윗머리를 덮는다) */}
        {!kid && (
          <mesh position={[0, 1.54, -0.02]}>
            <boxGeometry args={[0.56, 0.16, 0.52]} />
            <meshStandardMaterial color={c.hair} />
          </mesh>
        )}
        <mesh position={[0, 1.36, -0.22]}>
          <boxGeometry args={[0.56, 0.3, 0.1]} />
          <meshStandardMaterial color={c.hair} />
        </mesh>
        <mesh position={[-0.27, 1.4, 0]}>
          <boxGeometry args={[0.06, 0.22, 0.5]} />
          <meshStandardMaterial color={c.hair} />
        </mesh>
        <mesh position={[0.27, 1.4, 0]}>
          <boxGeometry args={[0.06, 0.22, 0.5]} />
          <meshStandardMaterial color={c.hair} />
        </mesh>
        {!kid && (
          <mesh position={[0, 1.5, 0.23]}>
            <boxGeometry args={[0.54, 0.12, 0.06]} />
            <meshStandardMaterial color={c.hair} />
          </mesh>
        )}
        {kid && (
          <>
            {/* 노란 모자 + 챙 (한국 초등학생의 상징) */}
            <mesh position={[0, 1.54, -0.02]}>
              <boxGeometry args={[0.58, 0.18, 0.54]} />
              <meshStandardMaterial color="#ffd166" />
            </mesh>
            <mesh position={[0, 1.47, 0.32]}>
              <boxGeometry args={[0.5, 0.05, 0.18]} />
              <meshStandardMaterial color="#e8b84a" />
            </mesh>
          </>
        )}
        {variant === 'monster' && (
          // 붉은 머리띠
          <mesh position={[0, 1.43, 0]}>
            <boxGeometry args={[0.56, 0.09, 0.52]} />
            <meshStandardMaterial color="#d84a4a" />
          </mesh>
        )}

        {/* 눈 */}
        <mesh position={[-0.11, 1.28, 0.25]}>
          <boxGeometry args={[0.07, 0.09, 0.02]} />
          <meshStandardMaterial color={EYE} />
        </mesh>
        <mesh position={[0.11, 1.28, 0.25]}>
          <boxGeometry args={[0.07, 0.09, 0.02]} />
          <meshStandardMaterial color={EYE} />
        </mesh>
      </group>
    </group>
  );
}
