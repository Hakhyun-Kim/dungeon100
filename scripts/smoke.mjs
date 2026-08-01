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

// 소리는 헤드리스에서 들을 수 없다 — 그래서 **노드를 센다**.
// 앱 코드보다 먼저 AudioContext를 감싸 두면 "마스터 버스가 하나로 모였나(컴프레서 1개)",
// "소리가 실제로 났나(오실레이터·버퍼 > 0)"를 숫자로 확인할 수 있다. 믹스가 조용히 깨진 채
// 배포되는 걸 막는 유일한 방법. 세는 대상은 '구현'이 아니라 **약속**이어야 한다 —
// "컴프레서는 마스터 버스 하나뿐"은 레시피를 어떻게 바꾸든 참이어야 하는 명제다.
async function installAudioProbe(ctx) {
  await ctx.addInitScript(() => {
    const w = window;
    w.__audio = { osc: 0, buf: 0, comp: 0 };
    const P = w.AudioContext && w.AudioContext.prototype;
    if (!P) return;
    for (const [key, method] of [
      ['osc', 'createOscillator'],
      ['buf', 'createBufferSource'],
      ['comp', 'createDynamicsCompressor'],
    ]) {
      const orig = P[method];
      P[method] = function (...a) {
        w.__audio[key]++;
        return orig.apply(this, a);
      };
    }
  });
}

async function prodPhase(browser) {
  console.log('\n── ① 프로덕션 프리뷰 — 첫 방문자 동선 ──');
  const server = startVite(['preview'], PROD_PORT);
  try {
    await waitServer(`http://localhost:${PROD_PORT}/`);
    const ctx = await browser.newContext(); // 새 컨텍스트 = 빈 localStorage (첫 방문자)
    await installAudioProbe(ctx);
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

    // 오디오 — 여기까지 오면 메뉴 클릭(tap)·던전 입장(enter)·전투음이 이미 났어야 한다
    const audio = await page.evaluate(() => window.__audio);
    must(audio.osc + audio.buf > 0, `소리가 실제로 났다 (osc ${audio.osc} · buf ${audio.buf})`);
    must(audio.comp === 1, `마스터 버스 하나로 수렴 (컴프레서 ${audio.comp}개 — 1이어야 함)`);

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
    // 여기서만 순간이동을 쓴다 — 1층은 「마지막 문단」(8층+) 밖이고 적도 옅어서
    // 전투 상황을 왜곡하지 않는다. **밸런스·전투를 재는 검증에는 순간이동 금지** —
    // 사람이 만들 수 없는 상황(무리 한가운데 착지 등)이 만들어져 결과가 망가진다.
    // 그런 검증은 시뮬봇(simBot)처럼 실제로 걸어서 접근해야 한다.
    const floorNow = await page.evaluate(() => window.__d100.state().floorNo);
    must(floorNow < 8, `순간이동 안전 층 (실제 ${floorNow}층 — 8층 미만이어야 함)`);
    const exit = await page.evaluate(() => window.__d100.state().exit);
    await page.evaluate(([x, z]) => window.__d100.teleport(x, z), exit);
    // 포털은 이제 곧장 내려간다 (2026-07-26 — 걸어 들어간 게 곧 의도).
    // 갈림길(🔥 모험의 길)이 열린 층에서만 선택 화면이 남으므로 둘 다 받아 준다.
    const portalChoice = page.locator('.quiz-screen .choice-btn').filter({ hasText: '내려간다' });
    const draftCard = page.locator('.draft-screen .card').first();
    await Promise.race([
      draftCard.waitFor({ timeout: 20000 }),
      portalChoice.waitFor({ timeout: 20000 }).then(() => portalChoice.click()),
    ]);
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
