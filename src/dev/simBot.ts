// 밸런스 자동 시뮬레이터 (DEV 전용 — 프로덕션 번들 미포함)
// 봇이 1층부터 자동 플레이: BFS 길찾기 → 전투·탄막 회피 → 두 문 달리기(정답 문 조향) →
// 포털 → 드래프트 → 하강, 보스전 카이팅 포함. N판 반복 후 사망 층 분포 리포트.
//
// 사용법 (localhost, ?rafshim&debug 권장 — 숨김 탭에서도 고속 구동):
//   __d100sim.start({ runs: 5 })                  — 5판 자동 플레이 (hard: 기준선 프로필)
//   __d100sim.start({ runs: 5, profile: 'human' }) — 사람처럼 판단하는 플레이어
//   __d100sim.start({ runs: 3, chestEvery: 2 })   — 2층마다 보물 완주 가정(전설 보상)
//   __d100sim.stop() / __d100sim.status() / __d100sim.report
//
// ── 프로필 (2026-07-25)
//   'hard'  — 기존 기준선 봇. 출구로 직행, 드래프트 무작위, 방 이벤트 전부 거절.
//             balance-baseline.json이 이 프로필로 잡혀 있으므로 **동작을 절대 바꾸지 말 것**.
//   'human' — 사람처럼 판단한다. 실제 플레이어가 뭘 보고 결정하는지를 그대로 구현했다:
//             ① 보물상자를 지나치지 않고 먼저 들른다 (출구는 그다음)
//             ② 드래프트를 진화 힌트·희귀도·현재 체력으로 고른다 (무작위 아님)
//             ③ 방 이벤트를 상황으로 판단 — 제단은 체력이 넉넉할 때만, 두 갈래 틈은
//                실제로 출구가 가까워질 때만, 무너지는 서가는 출구까지 시간이 될 때만
//             ④ 체력이 위태로우면 회피를 키우고 보스에게서 물러난다
//             ⑤ 역류(카운트다운)가 시작되면 하던 일을 버리고 출구로 달린다
//             ⑥ 발밑 두 버튼을 실제로 탭한다 — ❄️ 찰나(둘러싸였을 때) / 💨 결의(맞기 직전)
// 층 캡 도달·멈춤 복구는 자동 리로드로 이어짐 (sessionStorage에 진행 저장).

type Profile = 'hard' | 'human';
type BotMode = 'kids' | 'adult' | 'monster';

interface SimOpts {
  runs: number; // 총 판 수
  profile: Profile; // 'hard' = 기준선(기존 동작 고정) / 'human' = 사람처럼 판단
  mode: BotMode; // 던전 종류 — 'monster'면 보물상자가 몬스터 아레나로 바뀐다
  arenaRetry: number; // 아레나에서 쓰러졌을 때 다시 도전할 최대 횟수 (넘으면 모은 보석만 받고 나감)
  maxFloor: number; // 이 층을 넘기면 '생존(cap)'으로 기록하고 다음 판
  chestEvery: number; // 0=보물상자 무시, n=매 n층마다 전설 보물 지급(Shift+P — 완주 가정)
  pumpN: number; // 헤드리스(__pump)일 때 반복당 프레임 수
  fixdt: number; // 고정 dt (헤드리스 전용)
  daily: boolean; // true = 타이틀에서 「오늘의 던전」으로 입장 (AI 사서 실기록 생성용)
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

const DEF: SimOpts = {
  runs: 5,
  profile: 'hard',
  mode: 'kids',
  arenaRetry: 2,
  maxFloor: 30,
  chestEvery: 0,
  pumpN: 3,
  fixdt: 0.05,
  daily: false,
};
const human = () => opts.profile === 'human';

let opts: SimOpts = { ...DEF };
let running = false;
let results: RunResult[] = [];
let lastFloor = 1;
let villageStall = 0; // 마을에서 씬 마운트 정체 감지 (스로틀링 워치독)
// runBrain이 한 번이라도 돈 판만 기록 — 이전 세트가 남긴 스테일 over-screen을
// 새 세트 첫 틱에 사망으로 세는 유령 기록 방지 (실측: death@1 아이템48)
let playedThisRun = false;

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

// ── 사람이 화면에서 읽는 것들 ──────────────────────────────────────────────
// 봇에게 특별한 정보를 주지 않는다. 플레이어가 HUD·카드에서 실제로 보는 것만 읽는다.

/** HUD 체력바의 "87 / 125" */
function readHp(): { hp: number; max: number; ratio: number } | null {
  const m = document.querySelector('.hp-text')?.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const hp = +m[1];
  const max = +m[2];
  return { hp, max, ratio: max > 0 ? hp / max : 0 };
}

/** 역류(무너지는 서가) 카운트다운이 흐르는 중인가 — HUD에 바가 떠 있으면 그렇다 */
const rushActive = () => !!document.querySelector('.rush-bar-wrap');

// ── 발밑 능력 버튼 (❄️ 찰나 / 💨 결의) ────────────────────────────────────
// 2026-07-29까지 이 두 기능은 "버튼을 눌러 실제로 발동하는가"가 한 번도 자동 검증되지
// 않았다(둘 다 DOM 클릭 대상 밖이라 봇이 건드리지 않았다). 여기서 실제 탭 경로를 태운다.
//
// ⚠️ human 프로필에서만 누른다 — hard는 balance-baseline.json의 기준선이라 동작 불변.
interface AbilityStat {
  ready: number; // 게이지가 가득 찬 횟수 (0→ready 상승 에지)
  taps: number; // 봇이 실제로 누른 횟수
  fires: number; // 발동이 확인된 횟수 (씬의 active가 0→양수)
  viaButton: number; // 그중 DOM 버튼 탭으로 발동한 횟수 (나머지는 키보드 대체 경로)
  hpLossWhileActive: number; // 발동 중 체력이 깎인 횟수 — 결의는 무적이므로 0이어야 한다
}
const newAbil = (): AbilityStat => ({ ready: 0, taps: 0, fires: 0, viaButton: 0, hpLossWhileActive: 0 });
let abil: Record<'freeze' | 'resolve', AbilityStat> = { freeze: newAbil(), resolve: newAbil() };
const abilPrev = {
  freeze: { ready: false, active: 0, hp: 1 },
  resolve: { ready: false, active: 0, hp: 1 },
};
const abilCd = { freeze: 0, resolve: 0 };

/**
 * 발밑 버튼을 실제 손가락처럼 누른다.
 * 훅(useFreezeInput/useResolveInput)이 듣는 건 **pointerdown**이라 `btn.click()`으로는
 * 절대 발동하지 않는다 — PointerEvent를 직접 쏘고, 버튼을 못 찾을 때만 키(F/R)로 대체한다.
 * 어느 경로로 발동했는지 리포트에 남겨 "버튼이 실제로 먹혔다"를 구분할 수 있게 한다.
 */
function tapAbility(sel: string, code: string): 'button' | 'key' {
  // ⚠️ 버튼이 둘일 수 있다 — 아레나 중에도 DungeonScene은 마운트된 채(hidden)라 자기 몫의
  // 💨 버튼을 들고 있다. 사람 눈에는 정지된 쪽이 숨겨져 하나만 보이지만(훅의 150ms 폴링이
  // display를 끈다), 헤드리스에서는 그 타이머가 스로틀에 죽어 있을 수 있어 어느 쪽이
  // '보이는 버튼'인지 DOM만으로는 못 가린다. 그래서 전부에 쏜다 —
  // 정지된 씬의 버튼은 훅 안에서 pausedRef로 스스로 무시하므로 오발동이 없다.
  const btns = [...document.querySelectorAll<HTMLButtonElement>(sel)];
  if (btns.length) {
    for (const btn of btns) {
      const ev =
        typeof PointerEvent === 'function'
          ? new PointerEvent('pointerdown', { bubbles: true })
          : new Event('pointerdown', { bubbles: true });
      btn.dispatchEvent(ev);
    }
    return 'button';
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase() }));
  return 'key';
}

/** 씬이 노출하는 게이지 상태를 추적해 상승/하강 에지를 센다 (누른 뒤 실제로 켜졌는지의 증거) */
function trackAbility(
  kind: 'freeze' | 'resolve',
  st: { ready: boolean; active: number } | undefined,
  hpRatio: number,
  step: number,
) {
  if (abilCd[kind] > 0) abilCd[kind] = Math.max(0, abilCd[kind] - step);
  if (!st) return;
  const prev = abilPrev[kind];
  if (st.ready && !prev.ready) abil[kind].ready++;
  if (st.active > 0 && prev.active <= 0) {
    abil[kind].fires++;
    prev.hp = hpRatio; // 발동 순간의 체력 — 꺼질 때 비교한다
  } else if (st.active <= 0 && prev.active > 0) {
    if (hpRatio < prev.hp - 0.001) abil[kind].hpLossWhileActive++;
  }
  prev.ready = st.ready;
  prev.active = st.active;
}

/** 게이지가 찼고 쿨이 지났으면 누른다 (연타로 탭 수만 부풀지 않게 0.6초 간격) */
function fireAbility(kind: 'freeze' | 'resolve', st: { ready: boolean } | undefined) {
  if (!st?.ready || abilCd[kind] > 0) return;
  abilCd[kind] = 0.6;
  const via = tapAbility(kind === 'freeze' ? '.freeze-btn' : '.resolve-btn', kind === 'freeze' ? 'KeyF' : 'KeyR');
  abil[kind].taps++;
  if (via === 'button') abil[kind].viaButton++;
}

/** 가장 가까운 적까지의 거리 / 반경 안 적 수 — 사람이 화면에서 "둘러싸였다"를 읽는 것에 해당 */
function crowdAround(px: number, pz: number, list: number[][] | undefined, r: number) {
  let near = Infinity;
  let n = 0;
  for (const e of list ?? []) {
    const d = Math.hypot(e[0] - px, e[1] - pz);
    if (d < near) near = d;
    if (d < r) n++;
  }
  return { near, n };
}

/** 나를 향해 오는 탄이 코앞인가 (다가오는 방향만 센다 — 회피 벡터와 같은 판정) */
function incomingShots(px: number, pz: number, list: number[][] | undefined, r: number) {
  let n = 0;
  for (const e of list ?? []) {
    const ex = px - e[0];
    const ez = pz - e[1];
    if (Math.hypot(ex, ez) < r && e[2] * ex + e[3] * ez > 0) n++;
  }
  return n;
}

/**
 * 드래프트 카드 점수 — 사람이 카드를 고를 때 보는 순서 그대로.
 *  1) 금빛 「합본」 카드가 떴다면 무조건 (플레이 방식을 바꾸는 잿팟)
 *  2) 「집으면 완성!」 힌트 → 다음이 합본이다
 *  3) 합본까지 남은 장수가 적을수록 좋다
 *  4) 그 외엔 희귀할수록 좋고, 체력이 위태로우면 생존 카드에 손이 간다
 */
function scoreCard(el: HTMLElement, hpRatio: number): number {
  if (el.classList.contains('evo')) return 1000;
  let sc = 0;
  const hint = el.querySelector('.evo-hint');
  if (hint) {
    if (hint.classList.contains('ready')) sc += 500;
    else {
      const n = +(hint.textContent?.match(/(\d+)장/)?.[1] ?? '9');
      sc += Math.max(60, 320 - n * 60);
    }
  }
  sc += el.classList.contains('rarity-legendary')
    ? 120
    : el.classList.contains('rarity-rare')
      ? 60
      : 20;
  const tag = el.querySelector('.card-tag')?.textContent ?? '';
  if (hpRatio < 0.4 && tag.includes('생존')) sc += 90; // 죽을 것 같으면 살아남는 걸 먼저
  else if (hpRatio > 0.7 && tag.includes('공격')) sc += 30; // 여유 있으면 화력에 투자
  return sc + Math.random() * 15; // 동점 흔들기 — 판마다 똑같은 빌드가 되지 않게
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
// 멈춤 감지 — 틱 단위 미세 변위는 회피 지터에 속는다(실측: 벽에 박힌 채 ±0.06 진동).
// 3초 앵커 창의 '순변위'로 판정하고, 걸리면 경로 재계산 + 잠깐 수직 이탈(벽 슬라이드).
let anchorPos: [number, number] | null = null;
let anchorT = 0;
let nudgeT = 0;
let nudgeSign = 1;
let chestGrantedFloor = -1;
// 보스전: 근접 링(4)에서 확전 — 원거리 링은 벽·어그로 경계에서 교착됐다.
// 가까울수록 사선 확보 + 자동 조준이 보스를 문다 (실측: 근접 시 6초에 700딜).
// 그래도 딜이 없으면(벽 뒤 포켓에 낌 — 거리 4.9에서 HP 불변 실측) BFS로 직접 파고든다.
let bossRing = 4;
let bossHpLast = -1;
let bossStallT = 0;
let bossPathMode = false; // 벡터 조향이 벽에 막힘 → 보스 셀까지 길찾기 모드
let bossEngaged = false; // 이 층에서 보스와 한 번이라도 교전했는가 (사람형: 상자 왕복 방지)
let bossPathAge = 0; // 보스가 움직이니 경로를 주기적으로 재계산
let pathGoal: 'exit' | 'boss' | 'chest' = 'exit';
// 교착 진단 트레이스 — 층 체류 60초를 넘기면 샘플링, stuck 기록 시 localStorage에 남긴다
let stallTrace: Record<string, unknown>[] = [];

// 지금 위치에서 목표 월드 좌표까지 몇 칸인가 (못 가면 null) — 사람이 미니맵을 보고
// "저기까지 얼마나 걸리지?"를 가늠하는 것에 해당한다.
function cellsTo(fromX: number, fromZ: number, toX: number, toZ: number): number | null {
  if (!grid) return null;
  const p = bfsPath(
    grid,
    toCell(grid, fromX),
    toCell(grid, fromZ),
    toCell(grid, toX),
    toCell(grid, toZ),
  );
  return p ? p.length : null;
}
const PLAYER_SPEED = 7; // 기본 이동 속도 — 실제론 빌드로 더 빨라지므로 보수적인 추정

/**
 * 방 이벤트 선택 화면이 떴을 때 "수락할까?"를 상황으로 판단한다 (human 프로필 전용).
 * 반환: true = 수락(첫 선택지), false = 그만둔다.
 */
function decideRoomEvent(screenText: string): boolean {
  const s = W.__d100?.state?.();
  const hp = readHp();
  const px = s?.player?.[0] ?? 0;
  const pz = s?.player?.[1] ?? 0;

  // 낡은 제단 — 최대 체력의 30%를 바친다. 여유가 있을 때만 (사람도 반피에선 안 한다)
  if (screenText.includes('낡은 제단')) return !!hp && hp.ratio > 0.55;

  // 무너지는 서가 — 보물을 받고 16초 안에 출구로. 출구까지 갈 만한지 실제로 재 본다.
  if (screenText.includes('기울어진 서가')) {
    if (!s || !grid) return false;
    const cells = cellsTo(px, pz, s.exit[0], s.exit[1]);
    if (cells == null) return false;
    const secs = (cells * grid.cell) / PLAYER_SPEED;
    return secs < 11 && (!hp || hp.ratio > 0.35); // 낙석 22%를 감당할 체력도 필요
  }

  // 두 갈래 틈 — 실제로 출구가 가까워질 때만 탄다 (지름길이 아니면 탈 이유가 없다)
  if (screenText.includes('두 갈래 틈')) {
    if (!s || !grid || !s.riftWorlds) return false;
    const [a, b] = s.riftWorlds as [number, number][];
    const nearA = Math.hypot(a[0] - px, a[1] - pz) <= Math.hypot(b[0] - px, b[1] - pz);
    const far = nearA ? b : a;
    const now = cellsTo(px, pz, s.exit[0], s.exit[1]);
    const after = cellsTo(far[0], far[1], s.exit[0], s.exit[1]);
    return now != null && after != null && after + 3 < now;
  }

  // 찢어진 페이지 — 층을 건너뛰면 그 층의 보물·드래프트가 통째로 날아간다. 성장을 택한다.
  return false;
}

function resetFloorNav() {
  grid = null;
  gridFloor = -1;
  path = null;
  wpIdx = 0;
  floorTime = 0;
  anchorPos = null;
  anchorT = 0;
  nudgeT = 0;
  bossRing = 4;
  bossHpLast = -1;
  bossStallT = 0;
  bossPathMode = false;
  bossPathAge = 0;
  bossEngaged = false;
  pathGoal = 'exit';
  stallTrace = [];
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
  // 아레나 통계 — 몬스터 모드에서 '보물상자 클리어율'을 재기 위한 것
  const arena = {
    tries: arenaTries,
    cleared: arenaCleared,
    failed: arenaFailed,
    clearRate: arenaTries ? +((arenaCleared / arenaTries) * 100).toFixed(1) : null,
  };
  const surgeStat = {
    seen: surgeSeen,
    deaths: surgeDeaths,
    deathRate: surgeSeen ? +((surgeDeaths / surgeSeen) * 100).toFixed(1) : null,
    // 봉우리 한 번당 깎인 체력 비율 (0.25 = 최대 체력의 25%를 잃었다)
    hpDrops: surgeDrops,
    avgHpDrop: surgeDrops.length
      ? +(surgeDrops.reduce((a, b) => a + b, 0) / surgeDrops.length).toFixed(3)
      : null,
    maxHpDrop: surgeDrops.length ? Math.max(...surgeDrops) : null,
  };
  const report = {
    opts,
    results,
    avgDeathFloor: avg,
    histogram,
    arena,
    surge: surgeStat,
    abilities: abil, // ❄️ 찰나 / 💨 결의 — 게이지 충전·탭·실제 발동 수
    at: new Date().toISOString(),
  };
  W.__d100sim.report = report;
  localStorage.setItem('d100sim-report', JSON.stringify(report)); // 리로드에도 남게
  console.log('===== 밸런스 시뮬레이션 리포트 =====');
  console.table(results);
  console.log(`평균 사망 층: ${avg} · 사망 층 분포:`, histogram);
  if (surgeStat.seen) {
    console.log(
      `마지막 문단 — 겪음 ${surgeStat.seen} · 사망 ${surgeStat.deaths} · ` +
        `평균 체력 손실 ${((surgeStat.avgHpDrop ?? 0) * 100).toFixed(1)}% · 최대 ${((surgeStat.maxHpDrop ?? 0) * 100).toFixed(1)}%`,
    );
  }
  if (arena.tries) {
    console.log(
      `아레나 — 시도 ${arena.tries} · 클리어 ${arena.cleared} · 실패 ${arena.failed} · 클리어율 ${arena.clearRate}%`,
    );
  }
  for (const k of ['freeze', 'resolve'] as const) {
    const a = abil[k];
    if (!a.ready && !a.taps) continue;
    console.log(
      `${k === 'freeze' ? '찰나 ❄️' : '결의 💨'} — 충전 ${a.ready} · 탭 ${a.taps}` +
        `(버튼 ${a.viaButton}) · 발동 ${a.fires} · 발동 중 피해 ${a.hpLossWhileActive}`,
    );
  }
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

// ── 몬스터 아레나 두뇌 (보물상자 '몬스터' 모드)
// 격자 없는 원형 경기장이라 길찾기가 필요 없다 — 가장 가까운 남은 보석으로 곧장 가되,
// 던전과 같은 방식으로 탄막에 수직 회피하고 무리에서 밀려난다.
// 아레나 통계는 '보물상자 클리어율'을 재기 위한 것 (판당 여러 번 열린다).
let arenaTries = 0;
let arenaCleared = 0;
let arenaFailed = 0;
let arenaSeen = false; // 이번 아레나를 이미 셌는가 (프레임마다 중복 집계 방지)
let arenaRetried = 0; // 이 상자에서 재도전한 횟수 (상자가 끝나면 0으로)
// 「마지막 문단」 — 출구 앞 긴장 봉우리를 몇 번 겪었고 그중 몇 번 죽었나
let surgeSeen = 0;
let surgeActive = false;
let surgeDeaths = 0;
// 봉우리가 '위협이 되긴 하는가'를 재려면 사망률만으로는 부족하다 —
// 0%가 "긴장이 있었지만 버텼다"인지 "아무 일도 없었다"인지 구분이 안 된다.
// 봉우리 동안 체력이 얼마나 깎였는지(비율)를 함께 기록한다.
let surgeHpAtStart = 1;
let surgeHpMin = 1;
const surgeDrops: number[] = [];

function arenaBrain(): void {
  const s = W.__d100arena?.state?.();
  if (!s || !s.char) return;
  if (!arenaSeen) {
    arenaSeen = true;
    arenaTries++;
  }
  const [px, pz] = s.char as [number, number];
  const bound = (s.radius ?? 9) - 0.9;

  // 가장 가까운 안 주운 보석으로
  let tx = 0;
  let tz = 0;
  let best = Infinity;
  for (const g of s.gemPos as { x: number; z: number; taken: boolean }[]) {
    if (g.taken) continue;
    const d = Math.hypot(g.x - px, g.z - pz);
    if (d < best) {
      best = d;
      tx = g.x;
      tz = g.z;
    }
  }
  if (best === Infinity) return; // 다 주웠다 — 클리어 연출 중
  const d0 = Math.hypot(tx - px, tz - pz) || 0.001;
  let vx = ((tx - px) / d0) * 1.3;
  let vz = ((tz - pz) / d0) * 1.3;

  // 탄막 회피 — 다가오는 탄에 수직 (던전 두뇌와 같은 규칙)
  for (const e of (s.eshots ?? []) as number[][]) {
    const ex = px - e[0];
    const ez = pz - e[1];
    const d = Math.hypot(ex, ez);
    if (d < 4.2 && e[2] * ex + e[3] * ez > 0) {
      const side = Math.sign(-e[3] * ex + e[2] * ez || 1);
      const w = 3.2 / (d + 0.3);
      vx += -e[3] * w * side;
      vz += e[2] * w * side;
    }
  }
  // 무리 근접 회피 — 보석 위에 몰려 있으면 파고들어야 하니 약하게
  for (const en of (s.enemiesPos ?? []) as number[][]) {
    const ex = px - en[0];
    const ez = pz - en[1];
    const d = Math.hypot(ex, ez);
    if (d < 2.3 && d > 0.001) {
      const w = 1.4 / (d + 0.2);
      vx += (ex / d) * w;
      vz += (ez / d) * w;
    }
  }
  // 경계 밖으로 밀리지 않게 안쪽으로 되민다
  const r = Math.hypot(px, pz);
  if (r > bound) {
    vx += (-px / (r || 1)) * 2;
    vz += (-pz / (r || 1)) * 2;
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

  // 💨 결의 — 아레나에는 찰나가 없고 결의만 이식돼 있다(2026-07-29). 무리가 몸에
  // 닿기 직전이면 뚫고 지나간다: 보석 위에 몰린 무리를 통과하는 게 이 자원의 제 자리다.
  {
    const hpR = readHp()?.ratio ?? 1;
    trackAbility('resolve', (s as AnyWin).resolve, hpR, opts.pumpN * opts.fixdt);
    if (human()) {
      const crowd = crowdAround(px, pz, s.enemiesPos as number[][], 3);
      if (crowd.near < 1.8 || (hpR < 0.4 && crowd.near < 3.2))
        fireAbility('resolve', (s as AnyWin).resolve);
    }
  }
}

// ── 던전 run phase 두뇌: 길찾기 + 회피 + 보스 카이팅
function runBrain() {
  const s = W.__d100?.state?.();
  if (!s || !s.player) return;
  playedThisRun = true;
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

  // 목표 셀까지 BFS 경로를 따라 조향 벡터를 만든다 (출구·보스 공용)
  const followPath = (tx: number, tz: number): boolean => {
    if (!path) {
      path = bfsPath(grid!, toCell(grid!, px), toCell(grid!, pz), toCell(grid!, tx), toCell(grid!, tz));
      wpIdx = 0;
    }
    if (!path) return false;
    while (
      wpIdx < path.length - 1 &&
      Math.hypot(toWorld(grid!, path[wpIdx][0]) - px, toWorld(grid!, path[wpIdx][1]) - pz) < 1.2
    ) {
      wpIdx++;
    }
    const wp = path[Math.min(wpIdx, path.length - 1)];
    const wx = toWorld(grid!, wp[0]);
    const wz = toWorld(grid!, wp[1]);
    const d = Math.hypot(wx - px, wz - pz) || 0.001;
    // 층이 길어질수록 경로 견인을 키운다 — 깊은 층 무리 사이를 밀고 나가는 절박함
    const pull = 1.2 + Math.min(1.0, floorTime / 60);
    vx = ((wx - px) / d) * pull;
    vz = ((wz - pz) / d) * pull;
    return true;
  };
  const setGoal = (g: 'exit' | 'boss' | 'chest') => {
    if (pathGoal !== g) {
      pathGoal = g;
      path = null;
    }
  };

  // ── 사람처럼: 보물상자를 지나치지 않는다.
  // 역류(카운트다운)가 돌면 하던 일을 버리고 출구로 — 지금은 시간이 전부다.
  const rushing = rushActive();
  // 「마지막 문단」 상태 추적 (씬이 노출하는 surge 상태를 그대로 읽는다)
  const surging = (s as AnyWin).surge?.state === 'active';
  const hpNowS = readHp();
  if (surging && !surgeActive) {
    surgeActive = true;
    surgeSeen++;
    surgeHpAtStart = hpNowS?.ratio ?? 1;
    surgeHpMin = surgeHpAtStart;
  } else if (surging) {
    if (hpNowS && hpNowS.ratio < surgeHpMin) surgeHpMin = hpNowS.ratio;
  } else if (!surging && surgeActive) {
    surgeActive = false;
    surgeDrops.push(+(surgeHpAtStart - surgeHpMin).toFixed(3));
  }
  if (bossActive) bossEngaged = true; // 한 번 붙었으면 보스에 전념한다
  const seekChest =
    human() &&
    !rushing &&
    !bossActive &&
    !bossEngaged && // 보스와 붙었다 떨어졌다 하며 상자로 되돌아가면 경로가 요동친다
    s.chestState === 'idle' &&
    !!s.chestWorld &&
    opts.chestEvery === 0; // chestEvery는 '완주 가정' 모드라 상자를 따로 찾을 필요가 없다

  if (bossActive) {
    // 보스 카이팅: 링 유지 + 접선 스트레이프. HP가 5초간 안 깎이면 링을 좁히고,
    // 최소 링에서도 딜이 없으면(벽 뒤 포켓 교착) BFS로 보스까지 직접 파고든다.
    const step0 = opts.pumpN * opts.fixdt;
    if (s.boss.hp !== bossHpLast) {
      bossHpLast = s.boss.hp;
      bossStallT = 0;
      bossPathMode = false; // 딜이 들어오면 다시 카이팅
    } else {
      bossStallT += step0;
      if (bossStallT > 5) {
        if (bossRing > 2.6) bossRing = Math.max(2.5, bossRing - 0.8);
        else bossPathMode = true;
        bossStallT = 0;
      }
    }
    // 사람처럼: 체력이 바닥이면 보스와의 거리를 벌려 숨을 돌린다.
    // 단 **초반 90초 동안만**. 던전 안에는 회복 수단이 없어서 무한정 물러나 봐야
    // 체력이 돌아오지 않는다 — 계속 벌리면 보스는 안 죽고 층 예산만 태우다 stuck이 난다
    // (실측 2026-07-25: 10층 보스에서 ring 7 고정이 bossRing 축소·bossPathMode 교착 복구를
    //  통째로 무력화해 3판 중 1판이 stuck). 90초가 지나면 물러남을 버리고 결판을 낸다.
    let ring = bossRing;
    if (human() && floorTime < 90 && !bossPathMode) {
      const hpNow = readHp();
      if (hpNow && hpNow.ratio < 0.3) ring = Math.max(ring, 7);
    }
    const dx = s.bossWorld[0] - px;
    const dz = s.bossWorld[1] - pz;
    const dist = Math.hypot(dx, dz) || 0.001;
    const ux = dx / dist;
    const uz = dz / dist;
    if (bossPathMode && dist > 2.2) {
      setGoal('boss');
      bossPathAge += step0;
      if (bossPathAge > 2.5) {
        bossPathAge = 0;
        path = null; // 보스가 움직이니 주기적으로 재계산
      }
      if (!followPath(s.bossWorld[0], s.bossWorld[1])) {
        vx = ux;
        vz = uz; // 길이 없으면 직진
      }
    } else {
      setGoal('exit'); // 카이팅 벡터 모드 (경로는 안 씀 — 다음 전환 대비 초기화만)
      vx = (dist - ring) * 0.5 * ux + -uz * 0.8;
      vz = (dist - ring) * 0.5 * uz + ux * 0.8;
    }
  } else if (surging) {
    // 「마지막 문단」 — 포털이 잠긴 동안 문 앞에 붙어 있으면 그냥 얻어맞는다.
    // 사람이라면 한 발 물러나 무리를 상대하다가 열리면 들어간다.
    const dxe = px - s.exit[0];
    const dze = pz - s.exit[1];
    const de = Math.hypot(dxe, dze) || 0.001;
    const want = 6; // 출구에서 이 정도 거리를 유지하며 교전
    const k = (de - want) * -0.6; // 가까우면 밀어내고 멀면 당긴다
    vx = (dxe / de) * k;
    vz = (dze / de) * k;
  } else if (seekChest) {
    // 상자 먼저 — 보상을 챙기고 나서 내려간다 (사람의 기본 동선)
    setGoal('chest');
    if (!followPath(s.chestWorld[0], s.chestWorld[1])) {
      setGoal('exit'); // 상자로 가는 길이 없으면 미련 없이 출구로
      followPath(s.exit[0], s.exit[1]);
    }
  } else {
    // 출구로 길찾기
    setGoal('exit');
    followPath(s.exit[0], s.exit[1]);
  }

  // 탄막 회피 (다가오는 탄에 수직) — 보스 경로 모드에선 절반만 (접근이 우선)
  const eshotScale = bossActive && bossPathMode ? 0.5 : 1;
  for (const e of s.eshots as number[][]) {
    const ex = px - e[0];
    const ez = pz - e[1];
    const d = Math.hypot(ex, ez);
    if (d < 4.2 && e[2] * ex + e[3] * ez > 0) {
      const side = Math.sign(-e[3] * ex + e[2] * ez || 1);
      const w = (3.5 * eshotScale) / (d + 0.3);
      vx += -e[3] * w * side;
      vz += e[2] * w * side;
    }
  }
  // 적 근접 회피 — 층이 길어질수록 회피를 줄이고 밀고 나간다 (몬스터 하우스 무리 교착 대책:
  // 회피 벡터가 길목 무리에 막혀 120초 stuck 나던 것을, 시간이 지나면 싸우며 돌파하게)
  let avoidScale = Math.max(0.3, 1 - floorTime / 90);
  if (human()) {
    // 체력이 위태로우면 더 조심스럽게 움직인다 (사람도 반피 밑에선 몸을 사린다).
    // 단 역류 중에는 시간이 목숨이라 조심할 겨를이 없다.
    const hpNow = readHp();
    if (hpNow && hpNow.ratio < 0.35 && !rushing) avoidScale = Math.min(1.8, avoidScale + 0.9);
    if (surging) avoidScale = Math.min(2.2, avoidScale + 0.7); // 광폭화 무리 사이는 더 조심
  }
  for (const en of s.enemiesPos as number[][]) {
    // 출구 문 앞을 지키는 적(수문장 포함)은 피하지 않는다 — 돌아서는 순간 문에 못 간다.
    // 자동 조준이 접근 중에 잡아 주고, 접촉 피해는 빌드로 버틴다.
    if (Math.hypot(en[0] - s.exit[0], en[1] - s.exit[1]) < 4) continue;
    const ex = px - en[0];
    const ez = pz - en[1];
    const d = Math.hypot(ex, ez);
    if (d < 2.6 && d > 0.001) {
      const w = (2.2 * avoidScale) / (d + 0.2);
      vx += (ex / d) * w;
      vz += (ez / d) * w;
    }
  }

  // 벽 슬라이드 — 멈춤이 감지되면 잠깐 진행 방향의 수직으로 밀어 코너에서 빠져나온다
  const step = opts.pumpN * opts.fixdt;
  if (nudgeT > 0) {
    nudgeT -= step;
    const tx = -vz * nudgeSign;
    const tz = vx * nudgeSign;
    vx += tx * 1.5;
    vz += tz * 1.5;
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

  // ── 발밑 두 버튼 (human 전용) — 사람이 왜 누르는지를 그대로 옮겼다.
  //   ❄️ 찰나 = 공격 자원: 무리에 둘러싸였을 때 세계를 멈춰 놓고 정리한다.
  //   💨 결의 = 회피 자원: 맞기 직전에 뚫고 나가거나, 시간에 쫓길 때 거리를 번다.
  // 방향은 이미 setKeys로 정해져 있다 — 대시는 그 순간의 입력 방향을 고정하므로,
  // 위험할 땐 회피 벡터(적 반대쪽), 역류/봉우리 땐 출구 쪽으로 자연히 튄다.
  {
    const hpR = readHp()?.ratio ?? 1;
    trackAbility('freeze', (s as AnyWin).freeze, hpR, step);
    trackAbility('resolve', (s as AnyWin).resolve, hpR, step);
    if (human()) {
      const crowd = crowdAround(px, pz, s.enemiesPos as number[][], 4.5);
      const shots = incomingShots(px, pz, s.eshots as number[][], 3.5);
      const bossClose =
        !!s.bossWorld && Math.hypot(s.bossWorld[0] - px, s.bossWorld[1] - pz) < 7;
      if (crowd.n >= 3 || bossClose || shots >= 2) fireAbility('freeze', (s as AnyWin).freeze);
      const cornered = crowd.near < 1.8 || (hpR < 0.4 && crowd.near < 3.2);
      if (cornered || ((rushing || surging) && want.size > 0))
        fireAbility('resolve', (s as AnyWin).resolve);
    }
  }

  // 멈춤 감지(3초 창 순변위) → 길 재계산 + 벽 슬라이드, 층 시간 초과 → 판 종료(리로드 복구)
  floorTime += step;
  anchorT += step;
  if (!anchorPos) {
    anchorPos = [px, pz];
    anchorT = 0;
  } else if (anchorT > 3) {
    if (Math.hypot(px - anchorPos[0], pz - anchorPos[1]) < 0.8 && !bossActive) {
      path = null;
      nudgeT = 2;
      nudgeSign = Math.random() < 0.5 ? 1 : -1;
    }
    anchorPos = [px, pz];
    anchorT = 0;
  }
  // 교착 진단 — 층 체류 60초부터 상태 샘플 (stuck 기록 시 localStorage에 저장)
  if (floorTime > 60 && stallTrace.length < 240) {
    stallTrace.push({
      ft: +floorTime.toFixed(1),
      p: [+px.toFixed(1), +pz.toFixed(1)],
      wp: wpIdx,
      pl: path ? path.length : null,
      keys: [...downKeys].map((k) => k.replace('Arrow', '')).join(','),
      scr: document.querySelector('.screen')?.className?.replace('screen ', '') ?? '',
      alt: (s as AnyWin).altarState,
      sec: (s as AnyWin).secretState,
    });
  }
  // 보스 층은 전투가 길어질 수 있어 예산을 넉넉히
  const budget = s.boss ? 300 : 120;
  if (floorTime > budget) {
    localStorage.setItem(
      'd100sim-stalltrace',
      JSON.stringify({ floor: s.floorNo, trace: stallTrace.filter((_, i) => i % 6 === 0) }),
    );
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

    // 1) 사망 화면 (실제로 플레이한 판만 기록 — 스테일 화면은 넘기기만)
    if (document.querySelector('.over-screen')) {
      releaseKeys();
      if (playedThisRun) {
        playedThisRun = false;
        if (surgeActive) {
          surgeDeaths++; // 「마지막 문단」을 못 버티고 쓰러졌다
          surgeActive = false;
        }
        recordRun('death', lastFloor);
        resetFloorNav();
        lastFloor = 1;
        if (results.length >= opts.runs) {
          finish();
          break;
        }
      }
      if (!clickBtn('.over-screen .choice-btn', '바로 다시 도전')) {
        reloadForNextRun(); // 체크포인트 화면이면 리로드로 새 판
        break;
      }
      continue;
    }
    // 2) 드래프트 — hard는 무작위, human은 진화 힌트·희귀도·체력을 보고 고른다.
    //    (아레나 임시 버프 2택 1도 같은 .card라 이 규칙 하나로 함께 처리된다)
    {
      const cards = [...document.querySelectorAll<HTMLButtonElement>('.draft-screen .card')];
      if (cards.length) {
        releaseKeys();
        if (human()) {
          const ratio = readHp()?.ratio ?? 1;
          let best = cards[0];
          let bestScore = -Infinity;
          for (const c of cards) {
            const sc = scoreCard(c, ratio);
            if (sc > bestScore) {
              bestScore = sc;
              best = c;
            }
          }
          best.click();
        } else {
          cards[Math.floor(Math.random() * cards.length)].click();
        }
        continue;
      }
    }
    // 3) 미니게임 — 수학 모드는 두 문 달리기, 몬스터 모드는 아레나
    if (document.querySelector('.doorrun-hint')) {
      // 같은 힌트 클래스를 쓰므로 어느 미니게임인지는 DEV 훅 존재로 가른다
      if (W.__d100arena) arenaBrain();
      else steerDoorRun();
      continue;
    }
    // 3.5) 아레나에서 쓰러짐 — 정해진 횟수까지 다시 도전, 그 뒤엔 모은 보석만 받고 나간다.
    //      (아레나 사망은 본체 체력과 무관해 재도전이 공짜다 — 사람도 몇 번은 더 해 본다)
    if (document.querySelector('.quiz-screen h2')?.textContent?.includes('아레나에서 쓰러졌다')) {
      releaseKeys();
      if (arenaSeen) {
        arenaSeen = false;
        arenaFailed++;
      }
      if (arenaRetried < opts.arenaRetry) {
        if (clickBtn('.quiz-screen .choice-btn', '다시 도전')) {
          arenaRetried++;
          continue;
        }
      }
      // 포기 — 이 상자는 끝났으니 재도전 카운터를 비운다 (상자마다 독립적으로 센다)
      if (clickBtn('.quiz-screen .choice-btn', '받기') || clickBtn('.quiz-screen .choice-btn', '포기')) {
        arenaRetried = 0;
        continue;
      }
    }
    // 3.9) 아레나를 빠져나와 보상 화면이 떴다 = 클리어 (쓰러짐은 3.5에서 이미 셌다)
    if (arenaSeen && !W.__d100arena && !document.querySelector('.doorrun-hint')) {
      arenaSeen = false;
      arenaRetried = 0; // 이 상자는 끝났다
      arenaCleared++;
    }
    // 4) 보상 푸시-유어-럭
    //    hard  — 안전하게 즉시 수령 (기준선 유지)
    //    human — 더 달린다. 3문 완주가 전설 보물이고, 자신 있는 플레이어의 선택이다.
    if (document.querySelector('.quiz-screen')) {
      // 라벨은 라운드에 따라 '더 달린다' / '마지막 문에 도전'으로 바뀐다 — 둘 다 잡는다
      if (human()) {
        const deeper = [...document.querySelectorAll<HTMLButtonElement>('.quiz-screen .choice-btn')]
          .find((b) => !b.disabled && /더 달린다|마지막 문에 도전/.test(b.textContent ?? ''));
        if (deeper) {
          deeper.click();
          continue;
        }
      }
      if (clickBtn('.quiz-screen .choice-btn', '여기서 보상 받기')) continue;
    }
    // 5) 포털 — 화면이 없다. 몸을 넣으면 곧장 내려간다 (붉은 포털 = 🔥 모험의 길, 봇은 출구로만 간다)
    // 6) 마을 문 — 던전에 집중 (체크포인트를 만들지 않아 판이 깔끔)
    if (clickBtn('.quiz-screen .choice-btn', '던전에 집중한다')) continue;
    // 6.5) 방 이벤트(제단·서가·틈·찢어진 페이지)
    //   hard  — 전부 그만둔다 (기준선 측정 조건을 예전과 똑같이 유지)
    //   human — 상황으로 판단해 수락/거절 (decideRoomEvent)
    {
      const ev = document.querySelector<HTMLElement>('.quiz-screen');
      const canDecline = [...document.querySelectorAll<HTMLButtonElement>('.quiz-screen .choice-btn')]
        .some((b) => b.textContent?.includes('그만둔다'));
      if (ev && canDecline) {
        releaseKeys();
        const take = human() && decideRoomEvent(ev.innerText ?? '');
        if (take) {
          // 수락 = '그만둔다'가 아닌 첫 활성 선택지 (제단 '바친다' / 서가 '흔든다' / 틈 '들어간다').
          // 비활성(체력이 모자란 제단)이면 여기서 안 잡히고 아래 거절로 흘러간다.
          const yes = [...document.querySelectorAll<HTMLButtonElement>('.quiz-screen .choice-btn')]
            .find((b) => !b.disabled && !b.textContent?.includes('그만둔다'));
          if (yes) {
            yes.click();
            continue;
          }
        }
        if (clickBtn('.quiz-screen .choice-btn', '그만둔다')) continue;
      }
    }
    // 6.7) 타이틀 — 범용 big-btn(7)이 첫 버튼을 아무거나 누르기 전에 명시적으로.
    //      daily 옵션이면 「오늘의 던전」(사서 실주행), 아니면 「모험 시작」.
    if (document.querySelector('.title-screen')) {
      clickBtn('.title-screen button', opts.daily ? '오늘의 던전' : '모험 시작');
      continue;
    }
    // 6.8) 인트로 — 프레시 프로필(CI 러너)은 인트로가 뜨고 책 퀴즈에서 진행이 잠긴다: 건너뛰기
    if (document.querySelector('.story-screen')) {
      clickBtn('.story-screen .skip-btn', '건너뛰');
      continue;
    }
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
      const modeLabel =
        opts.mode === 'monster' ? '몬스터 던전' : opts.mode === 'adult' ? '어른 던전' : '초등학교';
      if (clickBtn('.village-talk .choice-btn', modeLabel)) continue;
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
    // 10) 던전 run phase (타이틀·인트로는 6.7/6.8에서 처리).
    //     HUD는 떴는데 씬 훅이 없다 = 헤드리스 캔버스 미측정으로 r3f가 못 뜬 것 —
    //     마을 분기(9)와 같은 재측정 강제 킥 (봇의 tick 루프가 RO 폴링 타이머를 굶긴다)
    if (W.__d100) runBrain();
    else if (document.querySelector('.hud')) window.dispatchEvent(new Event('resize'));
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
  results = []; // 수동 start()는 언제나 새 측정 — 이어가기는 리로드 복구(resume) 경로가 담당
  arenaTries = 0;
  arenaCleared = 0;
  arenaFailed = 0;
  arenaRetried = 0;
  arenaSeen = false;
  surgeSeen = 0;
  surgeDeaths = 0;
  surgeActive = false;
  surgeDrops.length = 0;
  abil = { freeze: newAbil(), resolve: newAbil() };
  running = true;
  lastFloor = 1;
  resetFloorNav();
  saveProgress(); // 시작 즉시 저장 — 어떤 리로드에도 자동 복구
  console.log(
    `[d100sim] 시작 — ${opts.runs}판, 프로필 ${opts.profile}, 모드 ${opts.mode}, ` +
      `층 캡 ${opts.maxFloor}, chestEvery ${opts.chestEvery}`,
  );
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
    profile: opts.profile,
    mode: opts.mode,
    arena: { tries: arenaTries, cleared: arenaCleared, failed: arenaFailed },
    abilities: abil,
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
