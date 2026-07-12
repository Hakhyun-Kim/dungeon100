// 던전과 두 문 달리기 미니게임이 같은 주인공을 공유한다 (세계관 통일)
export default function Hero() {
  return (
    <>
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
    </>
  );
}
