import { GRID } from './dungeon';

// 그리드 BFS 길찾기 — 자동 시연 드라이버가 목적지로 '헤매지 않고' 걷기 위한 공용 유틸.
// (프로덕션 번들 포함 — 순수 함수, 44×44 그리드라 비용 무시 가능)
// 반환: 셀 좌표 경로 [ [x,y], ... ] (시작 셀 제외, 목표 셀 포함). 못 찾으면 null.
export function findPathCells(
  cells: Uint8Array,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): [number, number][] | null {
  const idx = (x: number, y: number) => y * GRID + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID;
  if (!inb(fromX, fromY) || !inb(toX, toY)) return null;
  if (cells[idx(toX, toY)] !== 1) return null;
  const prev = new Int32Array(GRID * GRID).fill(-1);
  const start = idx(fromX, fromY);
  const goal = idx(toX, toY);
  if (start === goal) return [];
  prev[start] = start;
  const queue = [start];
  const dirs = [1, -1, GRID, -GRID];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    if (cur === goal) break;
    const cx = cur % GRID;
    for (const d of dirs) {
      const nxt = cur + d;
      // 좌우 이동의 행 넘어감 방지
      if (d === 1 && cx === GRID - 1) continue;
      if (d === -1 && cx === 0) continue;
      if (nxt < 0 || nxt >= GRID * GRID) continue;
      if (prev[nxt] !== -1 || cells[nxt] !== 1) continue;
      prev[nxt] = cur;
      queue.push(nxt);
    }
  }
  if (prev[goal] === -1) return null;
  const path: [number, number][] = [];
  let cur = goal;
  while (cur !== start) {
    path.push([cur % GRID, Math.floor(cur / GRID)]);
    cur = prev[cur];
  }
  path.reverse();
  return path;
}
