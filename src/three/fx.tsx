import * as THREE from 'three';

// ── 절차 생성 연출 텍스처 모음 (외부 에셋 없음 — 전부 캔버스 그라데이션)
//    블롭 섀도우: 탑다운에서 캐릭터가 바닥에 '붙어 보이게' 하는 발밑 원형 그림자.
//    글로우: 파티클·잔광용 부드러운 방사형 빛망울.

let blobTex: THREE.CanvasTexture | null = null;
export function getBlobShadowTexture(): THREE.CanvasTexture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

let glowTex: THREE.CanvasTexture | null = null;
export function getGlowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** 단일 대상용 블롭 섀도우 — 그룹 안에 넣으면 발밑에 원형 그림자가 깔린다 */
export function BlobShadow({ scale = 1, size = 1.6, y = 0.02 }: { scale?: number; size?: number; y?: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} scale={scale}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={getBlobShadowTexture()} transparent depthWrite={false} />
    </mesh>
  );
}
