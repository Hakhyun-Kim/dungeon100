import * as THREE from 'three';

// 한글/숫자 텍스트 → 캔버스 → 텍스처 (두 문 러너 labels.ts 방식의 축소판, 폰트 파일 없음)
const FONT = "'Jua', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";

export function makeTextTexture(
  text: string,
  opts: { width?: number; height?: number; color?: string; bg?: string | null; maxFontPx?: number } = {},
): THREE.CanvasTexture {
  const w = opts.width ?? 256;
  const h = opts.height ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, w, h);
  }
  let px = opts.maxFontPx ?? Math.floor(h * 0.55);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${px}px ${FONT}`;
  // 영역에 맞을 때까지 축소
  while (ctx.measureText(text).width > w * 0.88 && px > 12) {
    px -= 4;
    ctx.font = `${px}px ${FONT}`;
  }
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = opts.color ?? '#ffffff';
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}
