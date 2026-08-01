import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 밸런스 자동 시뮬레이터 봇 — DEV 전용 (프로덕션 번들에서 제거됨)
if (import.meta.env.DEV) {
  void import('./dev/simBot');
}

// 웹폰트(Jua)를 부팅 때 명시적으로 받아 둔다.
// 브라우저는 글자가 실제로 그려질 때만 폰트를 내려받는데, 이 게임은 문제판·NPC 이름표를
// **캔버스에 구워 텍스처로** 쓴다(textTexture.ts) — 그때 폰트가 아직 없으면 폴백 서체가
// 텍스처에 박혀 영영 안 바뀐다. 샘플 글자를 함께 주면 필요한 서브셋만 받는다.
// CDN이 막힌 환경(오프라인·사내망·CI 샌드박스)에서는 1.2초만 기다리고 폴백으로 진행한다 —
// 폰트 때문에 게임이 안 뜨는 쪽이 훨씬 나쁘다. 폴백 서체는 styles.css·textTexture.ts에 있다.
const fontsReady = (async () => {
  if (!document.fonts?.load) return;
  const wait = Promise.all([
    document.fonts.load('16px Jua', '백층던전0123'),
    document.fonts.load('bold 16px Jua', '백층던전0123'),
  ]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 1200))]).catch(() => {});
})();

void fontsReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
