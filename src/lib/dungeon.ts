import { mulberry32 } from './rng';

// 층 절차 생성 — 방을 흩뿌리고 L자 복도로 순서대로 이어 연결을 보장한다.
export const GRID = 44; // 한 변 셀 수
export const CELL = 2; // 셀 한 변의 월드 크기

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface FloorMap {
  cells: Uint8Array; // 1 = 바닥, 0 = 벽
  rooms: Room[];
  start: { x: number; y: number };
  exit: { x: number; y: number };
  spawns: { x: number; y: number }[];
}

export function isFloor(cells: Uint8Array, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  return cells[y * GRID + x] === 1;
}

export function cellToWorld(x: number, y: number): [number, number] {
  return [(x - GRID / 2) * CELL + CELL / 2, (y - GRID / 2) * CELL + CELL / 2];
}

// 월드 좌표가 벽에 박히지 않는지 반경 r로 검사 (네 모서리)
export function canStand(cells: Uint8Array, wx: number, wz: number, r: number): boolean {
  for (const [ox, oz] of [
    [-r, -r],
    [r, -r],
    [-r, r],
    [r, r],
  ] as const) {
    const cx = Math.floor((wx + ox) / CELL + GRID / 2);
    const cz = Math.floor((wz + oz) / CELL + GRID / 2);
    if (!isFloor(cells, cx, cz)) return false;
  }
  return true;
}

export function generateFloor(floorNo: number): FloorMap {
  const rand = mulberry32(floorNo * 1013904223 + 12345);
  const cells = new Uint8Array(GRID * GRID);
  const rooms: Room[] = [];
  const roomCount = Math.min(5 + Math.floor(floorNo / 3), 9);

  let guard = 0;
  while (rooms.length < roomCount && guard++ < 400) {
    const w = 5 + Math.floor(rand() * 5);
    const h = 5 + Math.floor(rand() * 5);
    const x = 2 + Math.floor(rand() * (GRID - w - 4));
    const y = 2 + Math.floor(rand() * (GRID - h - 4));
    const clash = rooms.some(
      (r) => x < r.x + r.w + 2 && r.x < x + w + 2 && y < r.y + r.h + 2 && r.y < y + h + 2,
    );
    if (clash) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }

  for (const r of rooms)
    for (let yy = r.y; yy < r.y + r.h; yy++)
      for (let xx = r.x; xx < r.x + r.w; xx++) cells[yy * GRID + xx] = 1;

  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(cells, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy, rand);
  }

  const start = { x: rooms[0].cx, y: rooms[0].cy };
  const last = rooms[rooms.length - 1];
  const exit = { x: last.cx, y: last.cy };

  // 적 스폰 — 시작 방은 안전지대, 출구 바로 옆도 비워 즉사 방지
  const spawns: { x: number; y: number }[] = [];
  const perRoom = 2 + Math.floor(floorNo / 4);
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    for (let k = 0; k < perRoom; k++) {
      const sx = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const sy = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (Math.abs(sx - exit.x) + Math.abs(sy - exit.y) < 3) continue;
      spawns.push({ x: sx, y: sy });
    }
  }

  return { cells, rooms, start, exit, spawns };
}

// 폭 2짜리 L자 복도
function carveCorridor(
  cells: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rand: () => number,
) {
  const carve = (x: number, y: number) => {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const xx = Math.min(GRID - 2, Math.max(1, x + dx));
        const yy = Math.min(GRID - 2, Math.max(1, y + dy));
        cells[yy * GRID + xx] = 1;
      }
  };
  if (rand() < 0.5) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y0);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x1, y);
  } else {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x0, y);
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y1);
  }
}
