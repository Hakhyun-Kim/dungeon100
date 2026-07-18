import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// 밸런스 자동 시뮬레이터 봇 — DEV 전용 (프로덕션 번들에서 제거됨)
if (import.meta.env.DEV) {
  void import('./dev/simBot');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
