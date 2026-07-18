// 밸런스 자동 시뮬레이터 (DEV 전용 — 프로덕션 번들 미포함)
// 봇이 1층부터 자동 플레이: BFS 길찾기 → 전투·탄막 회피 → 두 문 달리기(정답 문 조향) →
// 포털 → 드래프트 → 하강, 보스전 카이팅 포함. N판 반복 후 사망 층 분포 리포트.
//
// 사용법 (localhost, ?rafshim&debug 권장 — 숨김 탭에서도 고속 구동):
//   __d100sim.start({ runs: 5 })                  — 5판 자동 플레이
//   __d100sim.start({ runs: 3, chestEvery: 2 })   — 2층마다 보물 완주 가정(전설 보상)
//   __d100sim.stop() / __d100sim.status() / __d100sim.report
// 층 캡 도달·멈춤 복구는 자동 리로드로 이어짐 (sessionStorage에 진행 저장).

interface SimOpts {
  runs: number; // 총 판 수
  maxFloor: number; // 이 층을 넘기면 '생존(cap)'으로 기록하고 다음 판
  chestEvery: number; // 0=보물상자 무시, n=매 n층마다 전설 보물 지급(Shift+P — 완주 가정)
  pumpN: number; // 헤드리스(__pump)일 때 반복당 프레임 수
  fixdt: number; // 고정 dt (헤드리스 전용)
}
interface RunResult {
  run: number;
  floor: number; // 사망(또는 종료) 층
  result: 'death' | 'cap' | 'stuck';
  items: number; // 종료 시점 보유 아이템 수
}

type AnyWin = Record<string, any>;
const W = window as unknown as AnyWin;
const RESUME_KEY = 'd100sim-resume';

const DEF: SimOpts = { runs: 5, maxFloor: 30, chestEvery: 0, pumpN: 3, fixdt: 0.05 };

let opts: SimOpts = { ...DEF };
let running = false;
let results: RunResult[] = [];
let lastFloor = 1;
let villageStall = 0; // 마을에서 씬 마운트 정체 감지 (스로틀링 워치독)

// ── 키 합성 (useMoveInput/useSteer는 window 키 이벤트 기반)
// 주의: 층 전환마다 씬이 리마운트되어 새 리스너는 기존에 눌린 키를 모른다 —
// 원하는 키는 매번 keydown을 재전송한다 (리스너 쪽 keys.add는 멱등이라 무해).
const downKeys = new Set<string>();
function setKeys(want: Set<string>) {
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
    if (want.has(k)) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: k, key: k }));
      downKeys.add(k);
    } else if (downKeys.has(k)) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: k, key: k }));
      downKeys.delete(k);
    }
  }
}
const releaseKeys = () => setKeys(new Set());

const tick = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

function clickBtn(sel: string, text?: string): boolean {
  const btns = [...document.querySelectorAll<HTMLButtonElement>(sel)].filter((b) => !b.disabled);
  const b = text ? btns.find((x) => x.textContent?.includes(text)) : btns[0];
  if (b) {
    b.click();
    return true;
  }
  return false;
}

function countItems(): number {
  return [...document.querySelectorAll('.build-chip')].reduce((n, c) => {
    const m = c.textContent?.match(/×(\d+)/);
    return n + (m ? +m[1] : 1);
  }, 0);
}

// ── BFS 길찾기 (셀 그리드, 4방향)
interface Grid {
  cells: number[];
  grid: number;
  cell: number;
}
function bfsPath(g: Grid, sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
  const G = g.grid;
  const prev = new Int32Array(G * G).fill(-2);
  const q: number[] = [sy * G + sx];
  prev[sy * G + sx] = -1;
  while (q.length) {
    const cur = q.shift()!;
    const cx = cur % G;
    const cy = Math.floor(cur / G);
    if (cx === tx && cy === ty) {
      const path: [number, number][] = [];
      let at = cur;
      while (at >= 0) {
        path.push([at % G, Math.floor(at / G)]);
        at = prev[at];
      }
      return path.reverse();
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
      const ni = ny * G + nx;
      if (prev[ni] !== -2 || g.cells[ni] !== 1) continue;
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return null;
}
const toCell = (g: Grid, w: number) => Math.floor(w / g.cell + g.grid / 2);
const toWorld = (g: Grid, c: number) => (c - g.grid / 2) * g.cell + g.cell / 2;

// ── 층별 내비게이션 상태
let grid: Grid | null = null;
let gridFloor = -1;
let path: [number, number][] | null = null;
let wpIdx = 0;
let floorTime = 0;
let stuckTime = 0;
let lastPos: [number, number] | null = null;
let chestGrantedFloor = -1;
// 보스전: 근접 링(4)에서 확전 — 원거리 링은 벽·어그로 경계에서 교착됐다.
// 가까울수록 사선 확보 + 자동 조준이 보스를 문다 (실측: 근접 시 6초에 700딜).
let bossRing = 4;
let bossHpLast = -1;
let bossStallT = 0;

function resetFloorNav() {
  grid = null;
  gridFloor = -1;
  path = null;
  wpIdx = 0;
  floorTime = 0;
  stuckTime = 0;
  lastPos = null;
  bossRing = 4;
  bossHpLast = -1;
  bossStallT = 0;
}

const saveProgress = () =>
  sessionStorage.setItem(RESUME_KEY, JSON.stringify({ opts, results }));

function recordRun(result: RunResult['result'], floor: number) {
  results.push({ run: results.length + 1, floor, items: countItems(), result });
  saveProgress(); // 예기치 못한 리로드(vite 최적화 등)에도 진행 유지
  console.log(`[d100sim] run ${results.length}/${opts.runs} → ${result} @ ${floor}층`);
}

function finish() {
  running = false;
  releaseKeys();
  W.__d100fixdt = 0;
  sessionStorage.removeItem(RESUME_KEY);
  const deaths = results.filter((r) => r.result === 'death');
  const avg = deaths.length
    ? (deaths.reduce((s, r) => s + r.floor, 0) / deaths.length).toFixed(1)
    : '-';
  const histogram: Record<number, number> = {};
  for (const r of results) histogram[r.floor] = (histogram[r.floor] ?? 0) + 1;
  const report = { opts, results, avgDeathFloor: avg, histogram, at: new Date().toISOString() };
  W.__d100sim.report = report;
  localStorage.setItem('d100sim-report', JSON.stringify(report)); // 리로드에도 남게
  console.log('===== 밸런스 시뮬레이션 리포트 =====');
  console.table(results);
  console.log(`평균 사망 층: ${avg} · 사망 층 분포:`, histogram);
}

// 층 캡·멈춤 복구 — 진행을 저장하고 리로드해 새 판으로 (빌드·HP 완전 초기화)
function reloadForNextRun() {
  sessionStorage.setItem(RESUME_KEY, JSON.stringify({ opts, results }));
  location.reload();
}

// ── 두 문 달리기 자동 조향 (정답 문으로)
function steerDoorRun(): void {
  const s = W.__d100run?.state?.();
  if (!s || !s.char) return;
  const want = new Set<string>();
  if (s.char[0] < s.doorX - 0.3) want.add('ArrowRight');
  else if (s.char[0] > s.doorX + 0.3) want.add('ArrowLeft');
  setKeys(want);
}

// ── 던전 run phase 두뇌: 길찾기 + 회피 + 보스 카이팅
function runBrain() {
  const s = W.__d100?.state?.();
  if (!s || !s.player) return;
  lastFloor = s.floorNo;

  // 새 층 감지 → 지형 스냅샷·길 초기화 (+ 보물 완주 가정 시 전설 보상)
  if (s.floorNo !== gridFloor) {
    resetFloorNav();
    grid = W.__d100.grid();
    gridFloor = s.floorNo;
    if (opts.chestEvery > 0 && s.floorNo % opts.chestEvery === 0 && chestGrantedFloor !== s.floorNo) {
      chestGrantedFloor = s.floorNo;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'P', shiftKey: true }));
    }
  }
  if (!grid) return;
  const [px, pz] = s.player as [number, number];

  let vx = 0;
  let vz = 0;
  // 보스가 '가까울 때만' 카이팅 — 멀면 BFS로 접근해야 한다 (직선 당김은 벽에 박힘)
  const bossNear =
    s.boss &&
    s.boss.alive &&
    s.bossWorld &&
    Math.hypot(s.bossWorld[0] - px, s.bossWorld[1] - pz) < 13;
  const bossActive = bossNear;

  if (bossActive) {
    // 보스 카이팅: 링 유지 + 접선 스트레이프. HP가 5초간 안 깎이면 링을 좁혀 파고든다
    // (링 위 위치가 벽 뒤면 투사체가 벽에 막힘 — 가까울수록 사선 확보).
    const step0 = opts.pumpN * opts.fixdt;
    if (s.boss.hp !== bossHpLast) {
      bossHpLast = s.boss.hp;
      bossStallT = 0;
    } else {
      bossStallT += step0;
      if (bossStallT > 5) {
        bossRing = Math.max(2.5, bossRing - 0.8);
        bossStallT = 0;
      }
    }
    const dx = s.bossWorld[0] - px;
    const dz = s.bossWorld[1] - pz;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist;
    const uz = dz / dist;
    vx = (dist - bossRing) * 0.5 * ux + -uz * 0.8;
    vz = (dist - bossRing) * 0.5 * uz + ux * 0.8;
  } else {
    // 출구로 길찾기
    if (!path) {
      const sp = bfsPath(grid, toCell(grid, px), toCell(grid, pz), toCell(grid, s.exit[0]), toCell(grid, s.exit[1]));
      path = sp;
      wpIdx = 0;
    }
    if (path) {
      while (
        wpIdx < path.length - 1 &&
        Math.hypot(toWorld(grid, path[wpIdx][0]) - px, toWorld(grid, path[wpIdx][1]) - pz) < 1.2
      ) {
        wpIdx++;
      }
      const wp = path[Math.min(wpIdx, path.length - 1)];
      const wx = toWorld(grid, wp[0]);
      const wz = toWorld(grid, wp[1]);
      const d = Math.hypot(wx - px, wz - pz) || 0.001;
      vx = ((wx - px) / d) * 1.2;
      vz = ((wz - pz) / d) * 1.2;
    }
  }

  // 탄막 회피 (다가오는 탄에 수직)
  for (const e of s.eshots as number[][]) {
    const ex = px - e[0];
    const ez = pz - e[1];
    const d = Math.hypot(ex, ez);
    if (d < 4.2 && e[2] * ex + e[3] * ez > 0) {
      const side = Math.sign(-e[3] * ex + e[2] * ez || 1);
      const w = 3.5 / (d + 0.3);
      vx += -e[3] * w * side;
      vz += e[2] * w * side;
    }
  }
  // 적 근접 회피
  for (const en of s.enemiesPos as number[][]) {
    const ex = px - en[0];
    const ez = pz - en[1];
    const d = Math.hypot(ex, ez);
    if (d < 2.6 && d > 0.001) {
      const w = 2.2 / (d + 0.2);
      vx += (ex / d) * w;
      vz += (ez / d) * w;
    }
  }

  const mag = Math.hypot(vx, vz) || 1;
  const nx = vx / mag;
  const nz = vz / mag;
  const want = new Set<string>();
  if (nx < -0.35) want.add('ArrowLeft');
  if (nx > 0.35) want.add('ArrowRight');
  if (nz < -0.35) want.add('ArrowUp');
  if (nz > 0.35) want.add('ArrowDown');
  setKeys(want);

  // 멈춤 감지 → 길 재계산, 층 시간 초과 → 판 종료(리로드 복구)
  const step = opts.pumpN * opts.fixdt;
  floorTime += step;
  if (lastPos && Math.hypot(px - lastPos[0], pz - lastPos[1]) < 0.05 && !bossActive) {
    stuckTime += step;
    if (stuckTime > 4) {
      path = null;
      stuckTime = 0;
    }
  } else {
    stuckTime = 0;
  }
  lastPos = [px, pz];
  // 보스 층은 전투가 길어질 수 있어 예산을 넉넉히
  const budget = s.boss ? 300 : 120;
  if (floorTime > budget) {
    recordRun('stuck', s.floorNo);
    if (results.length >= opts.runs) finish();
    else reloadForNextRun();
  }
}

// ── 메인 루프: 화면 상태를 읽어 규칙 순서대로 진행
async function loop() {
  // 숨김 탭 캔버스 미측정(300×150) 대비 — r3f 재측정 강제 후 시작
  window.dispatchEvent(new Event('resize'));
  while (running) {
    await tick();
    if (!running) break;
    if (W.__pump) {
      W.__d100fixdt = opts.fixdt;
      W.__pump(opts.pumpN);
    }

    // 층 캡 → 생존 기록
    if (lastFloor > opts.maxFloor) {
      recordRun('cap', lastFloor);
      if (results.length >= opts.runs) finish();
      else reloadForNextRun();
      break;
    }

    // 1) 사망 화면
    if (document.querySelector('.over-screen')) {
      releaseKeys();
      recordRun('death', lastFloor);
      resetFloorNav();
      lastFloor = 1;
      if (results.length >= opts.runs) {
        finish();
        break;
      }
      if (!clickBtn('.over-screen .choice-btn', '바로 다시 도전')) {
        reloadForNextRun(); // 체크포인트 화면이면 리로드로 새 판
        break;
      }
      continue;
    }
    // 2) 드래프트 — 무작위 카드
    {
      const cards = [...document.querySelectorAll<HTMLButtonElement>('.draft-screen .card')];
      if (cards.length) {
        releaseKeys();
        cards[Math.floor(Math.random() * cards.length)].click();
        continue;
      }
    }
    // 3) 두 문 달리기 — 정답 문으로 조향
    if (document.querySelector('.doorrun-hint')) {
      steerDoorRun();
      continue;
    }
    // 4) 보상 푸시-유어-럭 — 안전하게 즉시 수령
    if (clickBtn('.quiz-screen .choice-btn', '여기서 보상 받기')) continue;
    // 5) 포털 — 내려간다
    if (clickBtn('.quiz-screen .choice-btn', '내려간다')) continue;
    // 6) 마을 문 — 던전에 집중 (체크포인트를 만들지 않아 판이 깔끔)
    if (clickBtn('.quiz-screen .choice-btn', '던전에 집중한다')) continue;
    // 6.5) 방 이벤트(제단·찢어진 페이지) — 그만둔다 (기존 밸런스 측정과 조건을 동일하게 유지)
    if (clickBtn('.quiz-screen .choice-btn', '그만둔다')) continue;
    // 7) 진행 버튼 (로어·기억·흔적·보상 확인 등)
    if (clickBtn('.screen .big-btn')) continue;
    // 8) 소녀 찻자리 등 town 화면 — 대화 넘기고 돌아간다
    if (document.querySelector('.town-screen')) {
      releaseKeys();
      if (clickBtn('.town-screen .choice-btn', '돌아간다')) continue;
      if (clickBtn('.town-screen .choice-btn', '가 볼게')) continue;
      const dlg = document.querySelector<HTMLElement>('.town-screen .dialog-box');
      if (dlg) dlg.click();
      continue;
    }
    // 9) 걸어다니는 마을 — 입구로 순간이동 → 초등 던전 입장
    if (document.querySelector('.village-hint') || document.querySelector('.village-talk')) {
      if (clickBtn('.village-talk .choice-btn', '초등학교')) continue;
      const act = document.querySelector<HTMLButtonElement>('.village-action');
      if (act && act.textContent?.includes('던전 입구')) {
        releaseKeys();
        act.click();
        continue;
      }
      if (W.__d100town?.place) {
        villageStall = 0;
        W.__d100town.place(3.6, -7.2);
      } else {
        // 숨김 탭에서는 캔버스 측정이 안 와 r3f 자식 씬이 못 뜬다 (canvas 300×150 고정)
        // → react-use-measure가 듣는 window resize 이벤트로 재측정을 강제한다.
        window.dispatchEvent(new Event('resize'));
        if (!villageStall) villageStall = Date.now();
        else if (Date.now() - villageStall > 20000) {
          villageStall = 0;
          reloadForNextRun(); // 최후 수단 — 판 기록 없이 진행 저장 후 리로드
          break;
        }
      }
      continue;
    }
    // 10) 타이틀
    if (clickBtn('button', '모험 시작')) continue;
    // 11) 던전 run phase
    if (W.__d100) runBrain();
  }
  releaseKeys();
}

// 루프 예외가 봇을 조용히 죽이지 않게 감싼다
function safeLoop() {
  loop().catch((e) => {
    console.error('[d100sim] 루프 예외 — 1초 후 재개', e);
    if (running) setTimeout(safeLoop, 1000);
  });
}

function start(o: Partial<SimOpts> = {}) {
  if (running) {
    console.warn('[d100sim] 이미 실행 중');
    return;
  }
  opts = { ...DEF, ...o };
  if (!o.runs || results.length === 0) results = [];
  running = true;
  lastFloor = 1;
  resetFloorNav();
  saveProgress(); // 시작 즉시 저장 — 어떤 리로드에도 자동 복구
  console.log(`[d100sim] 시작 — ${opts.runs}판, 층 캡 ${opts.maxFloor}, chestEvery ${opts.chestEvery}`);
  safeLoop();
}

function stop() {
  running = false;
  releaseKeys();
  W.__d100fixdt = 0;
  sessionStorage.removeItem(RESUME_KEY);
  console.log('[d100sim] 중지');
}

W.__d100sim = {
  start,
  stop,
  status: () => ({
    running,
    done: results.length,
    of: opts.runs,
    results,
    lastFloor,
    // 내비게이션 진단
    nav: {
      hasGrid: !!grid,
      pathLen: path ? path.length : null,
      wpIdx,
      floorTime: +floorTime.toFixed(1),
      keys: [...downKeys],
    },
  }),
  report: null as unknown,
};

// 리로드 복구 — 진행 중이던 시뮬레이션을 자동으로 이어간다
const resume = sessionStorage.getItem(RESUME_KEY);
if (resume) {
  try {
    const saved = JSON.parse(resume);
    opts = { ...DEF, ...saved.opts };
    results = saved.results ?? [];
    // 키는 유지 (finish/stop에서만 제거) — 복구 직후 또 리로드돼도 이어진다
    running = true;
    lastFloor = 1;
    resetFloorNav();
    console.log(`[d100sim] 리로드 복구 — ${results.length}/${opts.runs}판 완료 상태에서 계속`);
    safeLoop();
  } catch {
    sessionStorage.removeItem(RESUME_KEY);
  }
}

console.log('[d100sim] 밸런스 봇 준비 — __d100sim.start({ runs: 5 })');

export {};
