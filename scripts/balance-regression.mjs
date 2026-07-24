// 야간 밸런스 회귀 리그 — 실제 봇(simBot) 하드런 N판을 돌려 사망 층 분포를
// 기준선(balance-baseline.json, 2026-07-19 실측)과 비교한다. 범위를 벗어나면
// 종료 코드 2(드리프트)로 끝나고, 워크플로(balance-night.yml)가 GitHub 이슈를 연다.
// 결과 JSON은 balance-report.json으로 남겨 아티팩트로 업로드된다.
//
// 로컬 실행: npm run balance-regression (기본 5판 — 20분+ 걸릴 수 있음, RUNS=2 로 축소 가능)
import { readFileSync, writeFileSync } from 'node:fs';
import { startVite, waitServer, launchBrowser, gamePage, collectErrors, stopChild, wait } from './lib/driver.mjs';

const PORT = 5196;
const baseline = JSON.parse(readFileSync(new URL('./balance-baseline.json', import.meta.url), 'utf8'));
const RUNS = Number(process.env.RUNS) || baseline.runs;

console.log(`⚖️ 밸런스 회귀 — 하드런 ${RUNS}판 (기준: 중앙값 ${baseline.medianMin}~${baseline.medianMax}층)`);
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
  await page.evaluate((runs) => {
    localStorage.removeItem('d100sim-report');
    window.__d100sim.start({ runs });
  }, RUNS);

  // 판이 늘어날수록 오래 걸린다 — 판당 최대 15분 예산
  const deadline = Date.now() + RUNS * 15 * 60 * 1000;
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
    if (st) console.log(`  진행 ${st.done}/${st.of}판 · 현재 ${st.lastFloor}층`);
  }
} finally {
  if (browser) await browser.close();
  stopChild(server);
}
if (!report) {
  console.error('💥 시간 안에 리포트가 나오지 않음 (봇 교착?)');
  process.exit(1);
}

const deaths = report.results.filter((r) => r.result === 'death').map((r) => r.floor);
const stuck = report.results.filter((r) => r.result === 'stuck').length;
deaths.sort((a, b) => a - b);
const median = deaths.length ? deaths[deaths.length >> 1] : null;
const summary = {
  at: new Date().toISOString(),
  runs: report.results,
  deaths,
  median,
  stuck,
  baseline,
};
writeFileSync('balance-report.json', JSON.stringify(summary, null, 2) + '\n');
console.log('📊 사망 층:', deaths.join(', ') || '(없음)', `· 중앙값 ${median} · stuck ${stuck}`);

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
