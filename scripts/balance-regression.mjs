// 야간 밸런스 회귀 리그 — 실제 봇(simBot) 하드런 N판을 돌려 사망 층 분포를
// 기준선(balance-baseline.json, 2026-07-19 실측)과 비교한다. 범위를 벗어나면
// 종료 코드 2(드리프트)로 끝나고, 워크플로(balance-night.yml)가 GitHub 이슈를 연다.
// 결과 JSON은 balance-report.json으로 남겨 아티팩트로 업로드된다.
//
// 로컬 실행: npm run balance-regression (기본 5판 — 20분+ 걸릴 수 있음, RUNS=2 로 축소 가능)
// 프로필: PROFILE=human 으로 '사람처럼 판단하는 봇'의 분포도 잴 수 있다.
//   기준선 비교는 hard 프로필에서만 한다 (baseline이 hard로 잡혀 있다) —
//   human은 참고 지표로 리포트만 남기고 드리프트 판정은 건너뛴다.
//   사람형은 보물상자·방 이벤트를 다 챙기느라 훨씬 깊이 내려가서 판당 시간이 몇 배다
//   (실측: 하드런은 6~9층에서 끝나는데 사람형은 24층에서도 진행 중) — 그래서 판당 예산을
//   따로 잡고, MAXFLOOR로 층 캡을 낮춰 측정 시간을 조절할 수 있게 했다.
import { readFileSync, writeFileSync } from 'node:fs';
import { startVite, waitServer, launchBrowser, gamePage, collectErrors, stopChild, wait } from './lib/driver.mjs';

const PORT = 5196;
const baseline = JSON.parse(readFileSync(new URL('./balance-baseline.json', import.meta.url), 'utf8'));
const RUNS = Number(process.env.RUNS) || baseline.runs;
const PROFILE = process.env.PROFILE === 'human' ? 'human' : 'hard';
const MAX_FLOOR = Number(process.env.MAXFLOOR) || 30;
// MODE=monster 로 보물상자가 몬스터 아레나로 바뀌는 던전을 측정할 수 있다 (아레나 클리어율)
const MODE = ['kids', 'adult', 'monster'].includes(process.env.MODE) ? process.env.MODE : 'kids';
// 판당 예산 — 사람형은 상자·이벤트를 다 챙기며 훨씬 깊이 내려가므로 넉넉히 잡는다.
// 실측(2026-07-25): 사람형 25층 캡이 판당 약 17분 → 층 캡을 올리면 RUN_BUDGET으로 늘릴 것.
const RUN_BUDGET_MIN = Number(process.env.RUN_BUDGET) || (PROFILE === 'human' ? 25 : 15);

console.log(
  PROFILE === 'human'
    ? `⚖️ 참고 측정 — 사람형 봇 ${RUNS}판 (기준선 비교 없음)`
    : `⚖️ 밸런스 회귀 — 하드런 ${RUNS}판 (기준: 중앙값 ${baseline.medianMin}~${baseline.medianMax}층)`,
);
const server = startVite([], PORT);
let browser;
let report = null;
try {
  await waitServer(`http://localhost:${PORT}/`);
  browser = await launchBrowser();
  const { page } = await gamePage(browser);
  collectErrors(page);
  await page.goto(`http://localhost:${PORT}/?rafshim&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__d100sim, { timeout: 60000 });
  await page.evaluate(([runs, profile, maxFloor, mode]) => {
    localStorage.removeItem('d100sim-report');
    window.__d100sim.start({ runs, profile, maxFloor, mode });
  }, [RUNS, PROFILE, MAX_FLOOR, MODE]);

  const deadline = Date.now() + RUNS * RUN_BUDGET_MIN * 60 * 1000;
  while (Date.now() < deadline) {
    await wait(10000);
    const raw = await page
      .evaluate(() => localStorage.getItem('d100sim-report'))
      .catch(() => null); // 봇 자체 리로드 순간 — 다음 폴링에서 회복
    if (raw) {
      report = JSON.parse(raw);
      break;
    }
    const st = await page.evaluate(() => window.__d100sim?.status?.()).catch(() => null);
    if (st) {
      const ab = st.abilities;
      const abTxt = ab
        ? ` · ❄️${ab.freeze.fires}/${ab.freeze.taps} 💨${ab.resolve.fires}/${ab.resolve.taps}`
        : '';
      console.log(`  진행 ${st.done}/${st.of}판 · 현재 ${st.lastFloor}층${abTxt}`);
    }
  }
  if (!report) {
    // 시간 초과 — 봇이 어디까지 갔는지는 남겨야 원인(교착 vs 그냥 깊이 감)을 가릴 수 있다
    const st = await page.evaluate(() => window.__d100sim?.status?.()).catch(() => null);
    if (st) console.log(`  ⏱️ 예산 초과 — ${st.done}/${st.of}판 완료, 마지막 ${st.lastFloor}층`);
  }
} finally {
  if (browser) await browser.close();
  stopChild(server);
}
if (!report) {
  console.error(
    `💥 판당 ${RUN_BUDGET_MIN}분 예산 안에 리포트가 나오지 않음. ` +
      '위 진행 로그의 층이 계속 오르고 있었다면 교착이 아니라 봇이 깊이 내려간 것 — ' +
      'MAXFLOOR를 낮추거나 RUNS를 줄여 다시 재라.',
  );
  process.exit(1);
}

const deaths = report.results.filter((r) => r.result === 'death').map((r) => r.floor);
const stuck = report.results.filter((r) => r.result === 'stuck').length;
deaths.sort((a, b) => a - b);
const median = deaths.length ? deaths[deaths.length >> 1] : null;
const items = report.results.map((r) => r.items);
const avgItems = items.length ? +(items.reduce((a, b) => a + b, 0) / items.length).toFixed(1) : 0;
const summary = {
  at: new Date().toISOString(),
  profile: PROFILE,
  mode: MODE,
  maxFloor: MAX_FLOOR,
  arena: report.arena ?? null,
  surge: report.surge ?? null,
  abilities: report.abilities ?? null,
  runs: report.results,
  deaths,
  median,
  stuck,
  avgItems,
  baseline: PROFILE === 'hard' ? baseline : null,
};
writeFileSync('balance-report.json', JSON.stringify(summary, null, 2) + '\n');
console.log(
  '📊 사망 층:',
  deaths.join(', ') || '(없음)',
  `· 중앙값 ${median} · stuck ${stuck} · 평균 아이템 ${avgItems}`,
);
if (report.surge?.seen) {
  console.log(
    `✒️ 마지막 문단 — 겪음 ${report.surge.seen} · 사망 ${report.surge.deaths} · ` +
      `평균 체력 손실 ${((report.surge.avgHpDrop ?? 0) * 100).toFixed(1)}% · ` +
      `최대 ${((report.surge.maxHpDrop ?? 0) * 100).toFixed(1)}%`,
  );
}
if (report.arena?.tries) {
  console.log(
    `👹 아레나 — 시도 ${report.arena.tries} · 클리어 ${report.arena.cleared} · 클리어율 ${report.arena.clearRate}%`,
  );
}
for (const [k, label] of [['freeze', '❄️ 찰나'], ['resolve', '💨 결의']]) {
  const a = report.abilities?.[k];
  if (!a || (!a.ready && !a.taps)) continue;
  console.log(
    `${label} — 충전 ${a.ready} · 탭 ${a.taps}(버튼 ${a.viaButton}) · 발동 ${a.fires} · 발동 중 피해 ${a.hpLossWhileActive}`,
  );
}

// 사람형 봇은 참고 지표 — 기준선(하드런 기준)과 비교하지 않는다.
// 다만 교착(stuck)은 프로필과 무관한 결함이므로 여기서도 실패로 본다.
if (PROFILE === 'human') {
  if (stuck > 0) {
    console.error(`🚨 사람형 봇 교착 ${stuck}건 — 길찾기·선택 로직 확인 필요.`);
    process.exit(2);
  }
  console.log('📘 참고 측정 완료 (기준선 비교 없음).');
  process.exit(0);
}

const drift =
  median === null ||
  median < baseline.medianMin ||
  median > baseline.medianMax ||
  deaths.some((f) => f < baseline.hardFloorMin) ||
  stuck > 0;
if (drift) {
  console.error(
    `🚨 드리프트 — 중앙값 ${median} (기준 ${baseline.medianMin}~${baseline.medianMax}) · ` +
      `최저 사망 ${deaths[0] ?? '-'} · stuck ${stuck}. 최근 커밋의 밸런스 영향 확인 필요.`,
  );
  process.exit(2);
}
console.log('📗 기준선 안 — 밸런스 유지 중.');
