// 자동화 공용 드라이버 — 스모크 CI · AI 사서 실주행 · 밸런스 회귀가 함께 쓴다.
// vite 서버를 자식 프로세스로 띄우고 Playwright로 게임을 조작한다.
// 로컬에서는 브라우저 다운로드 없이 설치된 Chrome 채널을 재사용한다.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// vite를 node로 직접 실행 (npx 셸 차이 없이 윈도우/리눅스 동일 경로)
export function startVite(args, port) {
  const child = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', ...args, '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[vite:${port}] ${d}`));
  return child;
}

export async function waitServer(url, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // 아직 안 뜸 — 재시도
    }
    await wait(500);
  }
  throw new Error(`서버가 뜨지 않음: ${url}`);
}

export async function launchBrowser(opts = {}) {
  const o = {
    headless: true,
    // CI(리눅스 러너)는 소프트웨어 WebGL — 최신 크로미엄은 명시 플래그가 필요하다
    args: ['--enable-unsafe-swiftshader'],
    ...opts,
  };
  // 로컬은 설치된 Chrome 재사용 (npx playwright install 불필요) — CI는 다운로드한 chromium
  if (!process.env.CI) o.channel = process.env.SMOKE_CHANNEL || 'chrome';
  return chromium.launch(o);
}

// 콘솔 error + 미처리 예외 수집 — 스모크의 합격 기준
export function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url ?? '';
    const t = m.text();
    // 파비콘·터치 아이콘류 404는 게임 결함이 아님 (URL은 location에만 온다).
    // ghost/<날짜>.json 404도 by-design — 사서 실기록은 '없으면 모델 폴백'이 정상 경로다.
    if (/favicon|apple-touch-icon|manifest\.webmanifest/.test(url + t)) return;
    if (/\/ghost\/[\d-]+\.json/.test(url) && /Failed to load resource/.test(t)) return;
    errors.push(`[console] ${t}${url ? ` ← ${url}` : ''}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return errors;
}

export function stopChild(child) {
  if (child && !child.killed) {
    try {
      child.kill();
    } catch {
      // 이미 종료됨
    }
  }
}
