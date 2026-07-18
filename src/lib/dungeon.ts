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
  chest: { x: number; y: number } | null; // 보물상자 (층당 1개, 두 문 달리기로 개봉)
  homeDoor: { x: number; y: number } | null; // 5층마다 나타나는 마을로 가는 문 (이유는 아무도 모른다)
  trace: { x: number; y: number } | null; // 소녀의 흔적 (14·28·42·49층 — 56층 복선)
  girl: { x: number; y: number } | null; // 56층, 이야기 속 소녀 '여백'의 찻자리
}

// 소녀의 흔적이 놓이는 층
export const TRACE_FLOORS = [14, 28, 42, 49];
export const GIRL_FLOOR = 56;

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

// seedOffset — 일일 던전(날짜 시드) 등 변형 층. 0이면 기존과 동일 (층 번호 = 시드).
export function generateFloor(floorNo: number, seedOffset = 0): FloorMap {
  const rand = mulberry32(floorNo * 1013904223 + 12345 + seedOffset);
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
  // 층당 밀도 램프: 3층마다 방당 +1 (최대 7) — 내려갈수록 확실히 붐빈다
  const spawns: { x: number; y: number }[] = [];
  const perRoom = Math.min(7, 2 + Math.floor(floorNo / 3));
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    for (let k = 0; k < perRoom; k++) {
      const sx = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const sy = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (Math.abs(sx - exit.x) + Math.abs(sy - exit.y) < 3) continue;
      spawns.push({ x: sx, y: sy });
    }
  }

  // 보물상자 — 시작·출구 근처를 피해 배치
  let chest: { x: number; y: number } | null = null;
  const chestRooms = rooms.length >= 3 ? rooms.slice(1, -1) : rooms.slice(-1);
  for (let tries = 0; tries < 24 && !chest; tries++) {
    const r = chestRooms[Math.floor(rand() * chestRooms.length)];
    const cx = r.x + 1 + Math.floor(rand() * (r.w - 2));
    const cy = r.y + 1 + Math.floor(rand() * (r.h - 2));
    if (Math.abs(cx - exit.x) + Math.abs(cy - exit.y) < 4) continue;
    if (Math.abs(cx - start.x) + Math.abs(cy - start.y) < 3) continue;
    chest = { x: cx, y: cy };
  }

  // 5층마다 마을로 돌아가는 문 (책갈피)
  let homeDoor: { x: number; y: number } | null = null;
  if (floorNo % 5 === 0) {
    for (let tries = 0; tries < 24 && !homeDoor; tries++) {
      const r = rooms[Math.floor(rand() * rooms.length)];
      const hx = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const hy = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (Math.abs(hx - exit.x) + Math.abs(hy - exit.y) < 4) continue;
      if (Math.abs(hx - start.x) + Math.abs(hy - start.y) < 3) continue;
      if (chest && Math.abs(hx - chest.x) + Math.abs(hy - chest.y) < 3) continue;
      homeDoor = { x: hx, y: hy };
    }
  }

  // 소녀의 흔적 / 56층의 소녀 — 시작·출구·상자를 피해 배치
  const placeAway = (): { x: number; y: number } | null => {
    for (let tries = 0; tries < 24; tries++) {
      const r = rooms[Math.floor(rand() * rooms.length)];
      const px = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const py = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (Math.abs(px - exit.x) + Math.abs(py - exit.y) < 4) continue;
      if (Math.abs(px - start.x) + Math.abs(py - start.y) < 3) continue;
      if (chest && Math.abs(px - chest.x) + Math.abs(py - chest.y) < 3) continue;
      if (homeDoor && Math.abs(px - homeDoor.x) + Math.abs(py - homeDoor.y) < 3) continue;
      return { x: px, y: py };
    }
    return null;
  };
  const trace = TRACE_FLOORS.includes(floorNo) ? placeAway() : null;
  const girl = floorNo === GIRL_FLOOR ? placeAway() : null;

  // 소녀 주변은 안전지대 — 몬스터들이 그녀를 피해 다닌다 (28층 흔적의 복선과 일치)
  const safeSpawns =
    girl || trace
      ? spawns.filter((sp) => {
          if (girl && Math.abs(sp.x - girl.x) + Math.abs(sp.y - girl.y) < 5) return false;
          if (trace && Math.abs(sp.x - trace.x) + Math.abs(sp.y - trace.y) < 3) return false;
          return true;
        })
      : spawns;

  return { cells, rooms, start, exit, spawns: safeSpawns, chest, homeDoor, trace, girl };
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
