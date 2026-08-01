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
  // ── 방 이벤트 (2026-07-19) — 방에 태그만 얹는 절차 생성 확장
  altar: { x: number; y: number } | null; // 낡은 제단 — HP를 바치면 보물 (3층+, 30% 층)
  house: Room | null; // 몬스터 하우스 — 적이 빽빽한 방 (5층+, 22% 층, 흔적·소녀 층 제외)
  houseOrbs: { x: number; y: number }[]; // 몬스터 하우스 바닥의 코인 무더기 (3개)
  secret: { x: number; y: number } | null; // 찢어진 페이지 — 층 건너뛰는 비밀 문 (6~96층, 22% 층)
  rifts: [{ x: number; y: number }, { x: number; y: number }] | null; // 두 갈래 틈 — 층 안 순간이동 지름길 한 쌍 (4층+, 25% 층)
  collapse: { x: number; y: number } | null; // 무너지는 서가 — 보물을 받고 역류에 쫓긴다 (7층+ 비보스 20% 층)
  cave: boolean; // 이 층이 동굴형(셀룰러 오토마타)으로 깎였는가 — 연출·HUD 표시용
  mire: { x: number; y: number }[] | null; // 좀먹은 바닥 — 방 하나에 흩뿌린 함정 타일 패치 (5층+, 22% 층)
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

// ── 🔥 모험의 길 (2026-07-27) — 출구 곁에 놓이는 '붉은 포털'의 자리.
// 예전엔 포털에 몸을 넣으면 확인 화면이 떠 갈림길을 물었는데, 그게 이미 없앤
// '내려갈래?' 확인 화면과 똑같이 생겨서 **버그처럼 읽혔다**. 그래서 선택을 화면에서
// 던전 바닥으로 옮긴다 — 그냥 출구로 들어가면 평범한 길, 이 자리로 들어가면 사나운 층.
// (틈·보석·코인 무더기처럼 이 게임의 선택은 원래 '몸으로' 하는 것이다.)
// **난수를 한 번도 쓰지 않는다** — 층 시드 소비 순서가 그대로라 기존 층 구조가 한 칸도 안 바뀐다.
const FORK_MIN = 3; // 출구에서 이만큼은 떨어뜨린다 (실수로 밟히면 선택이 아니다)
const FORK_MAX = 5;
export function forkSpot(map: FloorMap): { x: number; y: number } | null {
  const busy: { x: number; y: number }[] = [map.start, map.exit];
  for (const f of [map.chest, map.homeDoor, map.trace, map.girl, map.altar, map.secret, map.collapse])
    if (f) busy.push(f);
  if (map.rifts) busy.push(...map.rifts);
  busy.push(...map.houseOrbs);
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = map.exit.y - FORK_MAX; y <= map.exit.y + FORK_MAX; y++) {
    for (let x = map.exit.x - FORK_MAX; x <= map.exit.x + FORK_MAX; x++) {
      if (!isFloor(map.cells, x, y)) continue;
      const d = Math.hypot(x - map.exit.x, y - map.exit.y);
      if (d < FORK_MIN || d > FORK_MAX) continue;
      const [wx, wz] = cellToWorld(x, y);
      if (!canStand(map.cells, wx, wz, 0.5)) continue; // 주인공 반경 0.42보다 넉넉하게
      if (busy.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) < 3)) continue;
      // 출구에서 4칸쯤 — 눈에는 같이 들어오되 발이 스치지는 않는 거리
      const score = Math.abs(d - 4) * 100 + y * GRID + x; // 동점은 좌표 순 (결정적)
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

// ── 동굴 층 (2026-07-25) — 방-복도 대신 셀룰러 오토마타로 깎아 낸 자연 동굴.
// 좁은 복도 전투와 다른 '개활지' 전투 리듬을 만든다 (슈터 사거리·대셔 돌진 체감이 달라짐).
// 판정은 층 시드와 **별도 난수 스트림**에서 뽑는다 — 그래야 방-복도 층의 rand 소비 순서가
// 예전과 완전히 같아 기존 층 구조가 그대로 재현된다 (층=시드 재현성 원칙).
const CAVE_BANDS = [1, 4, 7]; // 11~20 이끼 · 41~50 서리 · 71~80 잿빛 (테마 3구간에서만)

export function isCaveFloor(floorNo: number, seedOffset = 0): boolean {
  if (floorNo <= 3) return false; // 첫인상은 언제나 정연한 서가
  if (floorNo % 10 === 0) return false; // 보스층 제외 — 보스 반경 0.9는 좁은 굴에 낀다
  if (TRACE_FLOORS.includes(floorNo) || floorNo === GIRL_FLOOR) return false; // 복선 배치 보존
  if (!CAVE_BANDS.includes(Math.floor((floorNo - 1) / 10))) return false;
  return mulberry32(floorNo * 2654435761 + 99991 + seedOffset)() < 0.5;
}

// 셀룰러 오토마타로 동굴을 깎고, 그 안에서 '완전히 열린' 사각 방들을 찾아 돌려준다.
// 방을 전부 열린 칸으로만 잡는 이유: 아래쪽 배치 코드(상자·제단·스폰…)가 방 내부를
// 무조건 바닥으로 가정하기 때문 — 이 불변식만 지키면 공용 배치 로직을 손대지 않아도 된다.
// 연결성은 4-연결 최대 영역만 남겨 보장한다 (BFS 길찾기·시뮬봇이 그대로 통한다).
// 조건을 못 맞추면 null → 호출부가 기존 방-복도 생성으로 폴백한다.
function carveCave(rand: () => number, roomCount: number): { cells: Uint8Array; rooms: Room[] } | null {
  const cells = new Uint8Array(GRID * GRID);
  // 1) 무작위 채우기 (테두리는 언제나 벽)
  for (let y = 1; y < GRID - 1; y++)
    for (let x = 1; x < GRID - 1; x++) cells[y * GRID + x] = rand() < 0.56 ? 0 : 1;

  // 2) 스무딩 — 이웃 8칸 중 벽이 5개 이상이면 벽이 된다 (동굴 특유의 둥근 굴곡)
  for (let pass = 0; pass < 5; pass++) {
    const next = new Uint8Array(cells);
    for (let y = 1; y < GRID - 1; y++)
      for (let x = 1; x < GRID - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (cells[(y + dy) * GRID + (x + dx)] === 0) walls++;
          }
        next[y * GRID + x] = walls >= 5 ? 0 : 1;
      }
    cells.set(next);
  }

  // 3) 가장 큰 4-연결 영역만 남긴다 — 고립된 굴은 벽으로 메운다.
  //    4-연결로 판정해야 셀 그리드 BFS(findPathCells)와 축분리 이동이 반드시 통한다.
  const comp = new Int32Array(GRID * GRID).fill(-1);
  let bestId = -1;
  let bestSize = 0;
  let compId = 0;
  const queue = new Int32Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i++) {
    if (cells[i] !== 1 || comp[i] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    comp[i] = compId;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % GRID;
      for (const d of [1, -1, GRID, -GRID]) {
        if (d === 1 && cx === GRID - 1) continue;
        if (d === -1 && cx === 0) continue;
        const nxt = cur + d;
        if (nxt < 0 || nxt >= GRID * GRID) continue;
        if (cells[nxt] !== 1 || comp[nxt] !== -1) continue;
        comp[nxt] = compId;
        queue[tail++] = nxt;
      }
    }
    if (tail > bestSize) {
      bestSize = tail;
      bestId = compId;
    }
    compId++;
  }
  if (bestSize < 420) return null; // 굴이 너무 좁게 나왔다 — 방-복도로 폴백
  for (let i = 0; i < GRID * GRID; i++) if (comp[i] !== bestId) cells[i] = 0;

  // 4) 완전히 열린 사각 방 찾기 — 중심끼리 충분히 떨어뜨려 층이 짧아지지 않게 한다.
  const openBox = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) if (cells[yy * GRID + xx] !== 1) return false;
    return true;
  };
  const rooms: Room[] = [];
  for (const minGap of [10, 6, 3]) {
    for (let tries = 0; tries < 600 && rooms.length < roomCount; tries++) {
      const w = 3 + Math.floor(rand() * 3);
      const h = 3 + Math.floor(rand() * 3);
      const x = 1 + Math.floor(rand() * (GRID - w - 2));
      const y = 1 + Math.floor(rand() * (GRID - h - 2));
      if (!openBox(x, y, w, h)) continue;
      const cx = x + (w >> 1);
      const cy = y + (h >> 1);
      if (rooms.some((r) => Math.abs(r.cx - cx) + Math.abs(r.cy - cy) < minGap)) continue;
      rooms.push({ x, y, w, h, cx, cy });
    }
    if (rooms.length >= roomCount) break;
  }
  if (rooms.length < 4) return null; // 방을 못 앉혔다 — 방-복도로 폴백
  return { cells, rooms };
}

// seedOffset — 일일 던전(날짜 시드) 등 변형 층. 0이면 기존과 동일 (층 번호 = 시드).
export function generateFloor(floorNo: number, seedOffset = 0): FloorMap {
  const rand = mulberry32(floorNo * 1013904223 + 12345 + seedOffset);
  const roomCount = Math.min(5 + Math.floor(floorNo / 3), 9);
  // 동굴 층이면 지형을 통째로 다른 알고리즘으로 깎는다 (실패 시 아래 방-복도로 폴백)
  const carved = isCaveFloor(floorNo, seedOffset) ? carveCave(rand, roomCount) : null;
  const cells = carved ? carved.cells : new Uint8Array(GRID * GRID);
  const rooms: Room[] = carved ? carved.rooms : [];

  if (!carved) {
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
  }

  const start = { x: rooms[0].cx, y: rooms[0].cy };
  const last = rooms[rooms.length - 1];
  const exit = { x: last.cx, y: last.cy };

  // 적 스폰 — 시작 방은 안전지대, 출구 바로 옆도 비워 즉사 방지
  // 층당 밀도 램프: 3층마다 방당 +1 (최대 9 — 21층에 도달) — 내려갈수록 확실히 붐빈다.
  // 예전 캡 7(15층)은 깊은 층이 더 붐비지 않아 파밍 빌드가 무적 순항하는 원인 중 하나였다.
  const spawns: { x: number; y: number }[] = [];
  const perRoom = Math.min(9, 2 + Math.floor(floorNo / 3));
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    for (let k = 0; k < perRoom; k++) {
      const sx = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const sy = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (Math.abs(sx - exit.x) + Math.abs(sy - exit.y) < 3) continue;
      spawns.push({ x: sx, y: sy });
    }
  }

  // 동굴 층은 방이 작고 굴이 넓다 — 방 기준으로만 스폰하면 같은 수의 적이 1.6배 넓은 곳에
  // 흩어져 층이 거저 쉬워진다. 넓어진 만큼 굴 아무 데나 흩뿌려 '면적당 위협'을 맞춘다
  // (밸런스 봇 비교가 의미 있으려면 지형만 달라지고 압박은 같아야 한다).
  if (carved) {
    const open: { x: number; y: number }[] = [];
    for (let y = 1; y < GRID - 1; y++)
      for (let x = 1; x < GRID - 1; x++) {
        if (cells[y * GRID + x] !== 1) continue;
        if (Math.abs(x - start.x) + Math.abs(y - start.y) < 7) continue; // 시작 방은 안전지대
        if (Math.abs(x - exit.x) + Math.abs(y - exit.y) < 3) continue;
        open.push({ x, y });
      }
    const roomArea = rooms.reduce((a, r) => a + r.w * r.h, 0);
    const floorArea = cells.reduce((a: number, b) => a + b, 0);
    const extra = Math.round(perRoom * Math.max(0, (floorArea - roomArea * 2.2) / 160));
    for (let k = 0; k < extra && open.length > 0; k++) {
      spawns.push(open[Math.floor(rand() * open.length)]);
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

  // ── 방 이벤트 — 기존 배치(시작·출구·상자·문·흔적·소녀)를 전부 피해서 놓는다.
  //    (모든 rand 호출이 기존 배치 이후라 예전 층 구조는 그대로 재현된다)
  const avoid = [start, exit, chest, homeDoor, trace, girl].filter(
    (p): p is { x: number; y: number } => p !== null,
  );
  const placeEvent = (): { x: number; y: number } | null => {
    for (let tries = 0; tries < 24; tries++) {
      const r = rooms[Math.floor(rand() * rooms.length)];
      const px = r.x + 1 + Math.floor(rand() * (r.w - 2));
      const py = r.y + 1 + Math.floor(rand() * (r.h - 2));
      if (avoid.some((a) => Math.abs(px - a.x) + Math.abs(py - a.y) < 3)) continue;
      avoid.push({ x: px, y: py });
      return { x: px, y: py };
    }
    return null;
  };

  // 제단 — 「피를 잉크로.」 HP를 바치면 보물 하나 (3층부터, 30% 확률)
  const altar = floorNo >= 3 && rand() < 0.3 ? placeEvent() : null;

  // 찢어진 페이지(비밀 문) — 층을 건너뛴다 (6~96층, 22% 확률). 보스 층에는 안 놓는다.
  const secret =
    floorNo >= 6 && floorNo <= 96 && floorNo % 10 !== 0 && rand() < 0.22 ? placeEvent() : null;

  // 몬스터 하우스 — 중간 방 하나가 적으로 빽빽, 대신 코인 무더기 3개 (5층+, 22% 확률).
  // 흔적·소녀 층은 제외 (안전지대 필터와 얽히지 않게).
  let house: Room | null = null;
  const houseOrbs: { x: number; y: number }[] = [];
  if (floorNo >= 5 && !trace && !girl && rooms.length >= 4 && rand() < 0.22) {
    const mid = rooms.slice(1, -1);
    house = mid[Math.floor(rand() * mid.length)];
    const perRoom2 = Math.min(9, 2 + Math.floor(floorNo / 3));
    for (let k = 0; k < perRoom2 + 3; k++) {
      const sx = house.x + 1 + Math.floor(rand() * (house.w - 2));
      const sy = house.y + 1 + Math.floor(rand() * (house.h - 2));
      if (Math.abs(sx - exit.x) + Math.abs(sy - exit.y) < 3) continue;
      safeSpawns.push({ x: sx, y: sy }); // 흔적·소녀 층 제외라 필터와 무관
    }
    for (let k = 0; k < 3; k++) {
      houseOrbs.push({
        x: house.x + 1 + Math.floor(rand() * (house.w - 2)),
        y: house.y + 1 + Math.floor(rand() * (house.h - 2)),
      });
    }
  }

  // 두 갈래 틈 — 가장 멀리 떨어진 두 방을 잇는 순간이동 지름길 한 쌍 (4층+, 25%).
  // 발견의 재미 + 미로 단축. 소녀 층은 제외. (rand 호출은 여전히 기존 배치 뒤 — 층 구조 보존)
  let rifts: [{ x: number; y: number }, { x: number; y: number }] | null = null;
  if (floorNo >= 4 && !girl && rooms.length >= 4 && rand() < 0.25) {
    let bi = 0;
    let bj = 1;
    let bd = -1;
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy);
        if (d > bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    const placeIn = (r: Room): { x: number; y: number } | null => {
      for (let tries = 0; tries < 12; tries++) {
        const px = r.x + 1 + Math.floor(rand() * (r.w - 2));
        const py = r.y + 1 + Math.floor(rand() * (r.h - 2));
        if (avoid.some((a) => Math.abs(px - a.x) + Math.abs(py - a.y) < 3)) continue;
        avoid.push({ x: px, y: py });
        return { x: px, y: py };
      }
      return null;
    };
    const a = placeIn(rooms[bi]);
    const b = placeIn(rooms[bj]);
    if (a && b) rifts = [a, b];
  }

  // 무너지는 서가 — 흔들면 보물이 쏟아지지만 서가째 무너져 내린다 (7층+ 비보스, 20%).
  // 「지금 보물을 받고 제한 시간 안에 출구까지 달릴까?」 = 시간↔보물 트레이드.
  // (rand 호출이 기존 배치 전부의 뒤라 예전 층 구조는 그대로 재현된다)
  const collapse =
    floorNo >= 7 && floorNo % 10 !== 0 && rand() < 0.2 ? placeEvent() : null;

  // 좀먹은 바닥 — 책벌레가 갉아먹어 약해진 타일 패치 (5층+, 몬스터 하우스와 안 겹치게 22%).
  // 함정 칸은 눈에 보이게(DungeonScene이 어둡게 칠한다) 흩어져 있어 "무늬를 읽고 사이로
  // 지나갈까, 그냥 밟고 지름길로 갈까"를 real-time으로 판단하게 한다 — 정보를 숨기는 진짜
  // 지뢰찾기 대신, 빠르게 훑고 지나가야 하는 액션 게임에 맞게 '보이는 위험'으로 조정했다.
  // 방 내부(전부 바닥)에만 놓이므로 이동을 막지 않는다 — floor-check의 도달 가능성 불변식과 무관.
  let mire: { x: number; y: number }[] | null = null;
  if (floorNo >= 5 && !house && rooms.length >= 3 && rand() < 0.22) {
    const mid = rooms.length >= 3 ? rooms.slice(1, -1) : rooms;
    const r = mid[Math.floor(rand() * mid.length)];
    const picked: { x: number; y: number }[] = [];
    for (let yy = r.y + 1; yy < r.y + r.h - 1; yy++) {
      for (let xx = r.x + 1; xx < r.x + r.w - 1; xx++) {
        if (avoid.some((a) => Math.abs(xx - a.x) + Math.abs(yy - a.y) < 2)) continue;
        if (rand() < 0.32) picked.push({ x: xx, y: yy });
      }
    }
    if (picked.length >= 4) mire = picked;
  }

  return {
    cells,
    rooms,
    start,
    exit,
    spawns: safeSpawns,
    chest,
    homeDoor,
    trace,
    girl,
    altar,
    house,
    houseOrbs,
    secret,
    rifts,
    collapse,
    cave: carved !== null,
    mire,
  };
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
