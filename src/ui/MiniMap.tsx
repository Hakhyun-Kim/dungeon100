import { useEffect, useRef } from 'react';
import { GRID } from '../lib/dungeon';

// 미니맵 — "매판 새로 생성되는 던전"을 눈으로 보여주는 창.
// DungeonScene이 프레임마다 채널(ref)에 좌표·탐사 마스크를 써 넣고,
// 이 컴포넌트는 150ms 간격으로 읽어 캔버스에 그린다 (React 상태 없음 — 렌더 비용 최소).
// 로그라이크 관례대로 '가 본 곳'만 밝혀지고, 포털·상자·마을 문은 탐사한 뒤에만 표시.
export interface MiniMapChannel {
  cells: Uint8Array | null; // 1 = 바닥 (dungeon.ts 그리드)
  seen: Uint8Array | null; // 1 = 탐사함 (플레이어 주변이 밝혀진다)
  px: number; // 플레이어 셀 좌표 (소수)
  py: number;
  exitX: number;
  exitY: number;
  chestX: number; // -1 = 없음/소진
  chestY: number;
  homeX: number; // -1 = 없음/소진
  homeY: number;
  bossAlive: boolean;
  floorColor: string; // 테마 바닥색 (밝은 칸)
  version: number; // 층이 바뀌면 증가 → 즉시 다시 그림
}

export function makeMiniMapChannel(): MiniMapChannel {
  return {
    cells: null,
    seen: null,
    px: 0,
    py: 0,
    exitX: -1,
    exitY: -1,
    chestX: -1,
    chestY: -1,
    homeX: -1,
    homeY: -1,
    bossAlive: false,
    floorColor: '#3a2f55',
    version: 0,
  };
}

const SIZE = 124; // CSS 픽셀 한 변

export default function MiniMap({ chRef }: { chRef: React.MutableRefObject<MiniMapChannel> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let disposed = false;
    let lastVersion = -1;
    let pulse = 0;

    const draw = () => {
      if (disposed) return;
      const ch = chRef.current;
      const S = SIZE * dpr;
      const cs = S / GRID; // 셀 한 변 픽셀
      pulse = (pulse + 1) % 8;
      ctx.clearRect(0, 0, S, S);
      if (ch.cells && ch.seen) {
        lastVersion = ch.version;
        // 탐사한 바닥 셀
        ctx.fillStyle = ch.floorColor;
        for (let y = 0; y < GRID; y++) {
          for (let x = 0; x < GRID; x++) {
            const i = y * GRID + x;
            if (ch.seen[i] && ch.cells[i]) ctx.fillRect(x * cs, y * cs, cs + 0.5, cs + 0.5);
          }
        }
        const seenAt = (x: number, y: number) =>
          x >= 0 && y >= 0 && x < GRID && y < GRID && ch.seen![y * GRID + x] === 1;
        const dot = (x: number, y: number, color: string, r: number) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc((x + 0.5) * cs, (y + 0.5) * cs, r * dpr, 0, Math.PI * 2);
          ctx.fill();
        };
        // 목표 마커 — 탐사한 곳만 (발견의 재미 유지)
        if (seenAt(ch.exitX, ch.exitY)) dot(ch.exitX, ch.exitY, ch.bossAlive ? '#ff5d7e' : '#b9a3ff', 2.6);
        if (ch.chestX >= 0 && seenAt(ch.chestX, ch.chestY)) dot(ch.chestX, ch.chestY, '#ffd166', 2.2);
        if (ch.homeX >= 0 && seenAt(ch.homeX, ch.homeY)) dot(ch.homeX, ch.homeY, '#ffcf8a', 2.2);
        // 플레이어 (깜빡이는 흰 점)
        dot(ch.px, ch.py, pulse < 5 ? '#ffffff' : '#d8cff2', 2.8);
      }
    };

    draw();
    const id = setInterval(draw, 150);
    // 층 전환 직후 빈 화면 방지 — version 바뀌면 다음 tick에 자연 갱신되므로 interval로 충분
    void lastVersion;
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, [chRef]);

  return <canvas ref={canvasRef} className="mini-map" style={{ width: SIZE, height: SIZE }} />;
}
