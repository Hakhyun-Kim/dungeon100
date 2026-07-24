// 🤖 AI 사서 실주행 — 오늘의 던전(날짜=시드)을 실제 밸런스 봇(simBot)이 플레이해
// public/ghost/<KST 날짜>.json 실기록을 남긴다. Actions 일일 크론(daily-ghost.yml)이
// 매일 00:15 KST에 실행 → 커밋 → Pages 배포까지 잇는다.
// 클라이언트(App)는 일일 던전 시작 시 이 파일을 fetch — 있으면 모델(ghost.ts) 대신 실기록.
//
// 로컬 실행: npm run daily-ghost (설치된 Chrome 사용, 5~15분 — 봇이 진짜로 죽을 때까지 플레이)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { startVite, waitServer, launchBrowser, gamePage, collectErrors, stopChild, wait } from './lib/driver.mjs';

const PORT = 5198;
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

// 멱등 — 오늘 기록이 이미 저장소에 있으면 다시 뛰지 않는다 (수동 재실행·크론 중복 안전)
if (existsSync(`public/ghost/${date}.json`)) {
  console.log(`📗 public/ghost/${date}.json 이미 있음 — 오늘의 사서는 이미 다녀갔다 (생략)`);
  process.exit(0);
}

console.log(`🤖 사서 실주행 — 오늘의 던전 ${date}`);
const server = startVite([], PORT);
let browser;
try {
  await waitServer(`http://localhost:${PORT}/`);
  browser = await launchBrowser();
  // 페이지의 todayKey()는 브라우저 로컬 날짜 — KST로 고정해 파일명과 시드를 일치시킨다
  const { page } = await gamePage(browser, { timezoneId: 'Asia/Seoul' });
  const errors = collectErrors(page);
  await page.goto(`http://localhost:${PORT}/?rafshim&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__d100sim, { timeout: 60000 });
  await page.evaluate(() => {
    localStorage.removeItem('d100sim-report');
    window.__d100sim.start({ runs: 1, daily: true });
  });
  console.log('봇 출발 — 사망(또는 30층 캡)까지 대기…');

  // 봇은 교착 시 스스로 리로드해 이어간다(sessionStorage) — 리포트가 localStorage에 남을 때까지 폴링
  const deadline = Date.now() + 30 * 60 * 1000;
  let report = null;
  while (Date.now() < deadline) {
    await wait(5000);
    const raw = await page
      .evaluate(() => localStorage.getItem('d100sim-report'))
      .catch(() => null); // 리로드 순간엔 evaluate가 실패할 수 있다 — 다음 폴링에서 회복
    if (raw) {
      report = JSON.parse(raw);
      break;
    }
  }
  if (!report) throw new Error('30분 내에 리포트가 나오지 않음 (봇 교착?)');
  const run = report.results[0];
  if (!run) throw new Error('리포트에 판 기록이 없음');
  if (run.result === 'stuck') throw new Error(`봇이 ${run.floor}층에서 멈춤 — 기록으로 쓰지 않는다`);

  // 봇이 실제 플레이한 날짜(d100-daily)와 파일명이 일치하는지 검증 (시간대 사고 방지)
  const played = await page.evaluate(() => JSON.parse(localStorage.getItem('d100-daily') || 'null'));
  if (played && played.date !== date) throw new Error(`날짜 불일치: 봇 ${played.date} vs 러너 ${date}`);

  mkdirSync('public/ghost', { recursive: true });
  const rec = {
    date,
    floor: run.floor,
    result: run.result, // death = 그 층에서 잠듦 · cap = 30층 넘게 읽음(캡)
    items: run.items,
    source: 'simBot 실주행',
    generated: new Date().toISOString(),
  };
  writeFileSync(`public/ghost/${date}.json`, JSON.stringify(rec) + '\n');
  console.log(`📗 기록 저장 — public/ghost/${date}.json`, rec);
  if (errors.length) console.log(`(주행 중 콘솔 에러 ${errors.length}건 — 스모크가 별도 감시)`);
} finally {
  if (browser) await browser.close();
  stopChild(server);
}
