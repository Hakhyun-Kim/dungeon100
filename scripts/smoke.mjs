// 부팅 스모크 — 배포 전 회귀 방지 게이트 (deploy-pages.yml build job에서 실행, 실패 = 배포 중단).
//
// ① 프로덕션 프리뷰(vite preview, dist 필요): 첫 방문자 동선 그대로 —
//    타이틀 메뉴 확인 → ⚡ 바로 던전으로 → 모드 선택 → 1층 HUD·코치마크·사서 칩.
// ② 개발 서버(vite dev, DEV 훅): 진화 조합 지급 → 포털 → 드래프트 첫 슬롯 합본 확정 등장,
//    사서 고스트 분포 중앙값 검사.
// 두 단계 모두 콘솔 error·미처리 예외가 하나라도 있으면 실패.
//
// 로컬: npm run build 후 npm run smoke (설치된 Chrome 사용 — 다운로드 없음)
import { startVite, waitServer, launchBrowser, collectErrors, stopChild, wait } from './lib/driver.mjs';

const PROD_PORT = 4174;
const DEV_PORT = 5197;
const fails = [];
const must = (cond, msg) => {
  if (!cond) fails.push(msg);
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
};

async function prodPhase(browser) {
  console.log('\n── ① 프로덕션 프리뷰 — 첫 방문자 동선 ──');
  const server = startVite(['preview'], PROD_PORT);
  try {
    await waitServer(`http://localhost:${PROD_PORT}/`);
    const ctx = await browser.newContext(); // 새 컨텍스트 = 빈 localStorage (첫 방문자)
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${PROD_PORT}/?rafshim`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('.title-screen', { timeout: 20000 });
    const menu = await page.locator('.menu-col .big-btn').allTextContents();
    must(menu.length === 4, `타이틀 메뉴 4항목 (실제 ${menu.length}: ${menu.join(' / ')})`);
    must(menu.some((t) => t.includes('바로 던전으로')), '⚡ 바로 던전으로 메뉴 존재');

    await page.locator('.menu-col .big-btn', { hasText: '바로 던전으로' }).click();
    await page.locator('.menu-col .big-btn', { hasText: '초등학교' }).click();
    await page.waitForSelector('.hud .hud-chip', { timeout: 60000 });
    await page.waitForSelector('div.canvas canvas', { timeout: 60000 });
    const chip = await page.locator('.hud .hud-chip').first().textContent();
    must(/1층/.test(chip ?? ''), `1층 진입 (HUD: ${chip?.trim()})`);
    must(/🤖\d+/.test(chip ?? ''), 'AI 사서 칩 표시');
    const coach = await page
      .waitForSelector('.coach-chip', { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    must(coach, '1층 코치마크 표시 (첫 방문)');

    await wait(6000); // 전투 시뮬 몇 초 — 잉크 리빌·적 스폰 포함 런타임 에러 감시
    must(errors.length === 0, `프로덕션 콘솔 에러 0 (${errors.length}건)`);
    errors.forEach((e) => console.log('   ' + e));
    await ctx.close();
  } finally {
    stopChild(server);
  }
}

async function devPhase(browser) {
  console.log('\n── ② 개발 서버 — DEV 훅 심층 (포털→드래프트·합본·사서 분포) ──');
  const server = startVite([], DEV_PORT);
  try {
    await waitServer(`http://localhost:${DEV_PORT}/`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = collectErrors(page);
    await page.goto(`http://localhost:${DEV_PORT}/?rafshim&debug`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('.title-screen', { timeout: 30000 });
    await page.locator('.menu-col .big-btn', { hasText: '바로 던전으로' }).click();
    await page.locator('.menu-col .big-btn', { hasText: '초등학교' }).click();
    await page.waitForFunction(() => !!window.__d100 && !!window.__d100app, { timeout: 90000 });
    must(true, 'r3f 부팅 + DEV 훅 등장');

    // 사서 고스트 분포 — 시뮬봇 실측 보정 범위(중앙값 6~11층)를 벗어나면 밸런스 모델 회귀
    const dist = await page.evaluate(() => window.__d100app.ghostDist(2000));
    must(
      dist.med >= 6 && dist.med <= 11,
      `사서 분포 중앙값 ${dist.med}층 (p10 ${dist.p10} · p90 ${dist.p90} · max ${dist.max})`,
    );

    // 진화 조합(멀티샷×2+연사×2) 지급 → 다음 드래프트 첫 슬롯에 합본 확정 등장해야 한다
    await page.evaluate(() => {
      window.__d100app.give('multi');
      window.__d100app.give('multi');
      window.__d100app.give('rate');
      window.__d100app.give('rate');
    });
    const exit = await page.evaluate(() => window.__d100.state().exit);
    await page.evaluate(([x, z]) => window.__d100.teleport(x, z), exit);
    await page.locator('.dialog-choices .choice-btn', { hasText: '내려간다' }).click({ timeout: 20000 });
    await page.waitForSelector('.draft-screen .card', { timeout: 10000 });
    const cardN = await page.locator('.draft-screen .card').count();
    const evoN = await page.locator('.draft-screen .card.evo').count();
    must(cardN === 3, `드래프트 카드 3장 (실제 ${cardN})`);
    must(evoN === 1, `합본 확정 슬롯 등장 (실제 ${evoN})`);
    const hints = await page.locator('.draft-screen .evo-hint').allTextContents();
    console.log(`   진화 힌트 칩: ${hints.length ? hints.join(' | ') : '(이번 드래프트엔 재료 카드 없음)'}`);

    must(errors.length === 0, `개발 서버 콘솔 에러 0 (${errors.length}건)`);
    errors.forEach((e) => console.log('   ' + e));
    await ctx.close();
  } finally {
    stopChild(server);
  }
}

const browser = await launchBrowser();
try {
  await prodPhase(browser);
  await devPhase(browser);
} finally {
  await browser.close();
}

if (fails.length) {
  console.error(`\n💥 스모크 실패 ${fails.length}건:\n- ${fails.join('\n- ')}`);
  process.exit(1);
}
console.log('\n📗 스모크 통과 — 배포해도 좋다.');
