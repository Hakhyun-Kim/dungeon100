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

// ── 절차 생성 돌바닥/벽 텍스처 — 회색조로 그려 인스턴스·재질 색이 곱해진다.
//    (테마 10종이 팔레트를 정하고, 결은 공용 1장 — 메모리 절약 + 통일감)
const texHash = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

let floorTexCache: THREE.CanvasTexture | null = null;
export function getFloorTexture(): THREE.CanvasTexture {
  if (floorTexCache) return floorTexCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  // 밝기 평균 ~1.0 근처의 회색조 결 (팔레트를 어둡히지 않게)
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, S, S);
  // 얼룩 (넓고 옅은 명암)
  for (let i = 0; i < 26; i++) {
    const x = texHash(i * 3) * S;
    const y = texHash(i * 3 + 1) * S;
    const r = 10 + texHash(i * 3 + 2) * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = texHash(i * 7) < 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  // 잔모래 점묘
  for (let i = 0; i < 420; i++) {
    const x = texHash(i * 5 + 100) * S;
    const y = texHash(i * 5 + 101) * S;
    ctx.fillStyle = texHash(i) < 0.5 ? 'rgba(0,0,0,0.055)' : 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  // 균열 몇 줄
  ctx.strokeStyle = 'rgba(0,0,0,0.09)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let x = texHash(i * 11 + 40) * S;
    let y = texHash(i * 11 + 41) * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (texHash(i * 11 + k * 2 + 42) - 0.5) * 30;
      y += (texHash(i * 11 + k * 2 + 43) - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 타일 가장자리 — 살짝 눌린 테두리 + 좌상단 하이라이트 (돌판 느낌)
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(3, S - 3);
  ctx.lineTo(3, 3);
  ctx.lineTo(S - 3, 3);
  ctx.stroke();
  floorTexCache = new THREE.CanvasTexture(c);
  floorTexCache.colorSpace = THREE.SRGBColorSpace;
  floorTexCache.anisotropy = 4;
  return floorTexCache;
}

let wallTexCache: THREE.CanvasTexture | null = null;
export function getWallTexture(): THREE.CanvasTexture {
  if (wallTexCache) return wallTexCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, S, S);
  // 가로 층리 (책이 쌓인 듯한 지층 느낌)
  for (let row = 0; row < 4; row++) {
    const y = (row + 1) * (S / 4.6) + texHash(row * 13) * 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + 2);
    ctx.lineTo(S, y + 2);
    ctx.stroke();
  }
  // 얼룩·점묘
  for (let i = 0; i < 300; i++) {
    const x = texHash(i * 5 + 500) * S;
    const y = texHash(i * 5 + 501) * S;
    ctx.fillStyle = texHash(i + 77) < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)';
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  wallTexCache = new THREE.CanvasTexture(c);
  wallTexCache.colorSpace = THREE.SRGBColorSpace;
  wallTexCache.anisotropy = 4;
  return wallTexCache;
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
