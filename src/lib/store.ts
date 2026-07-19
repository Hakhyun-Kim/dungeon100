import { useState } from 'react';

// 저장 중단 스위치 — 자동 시연은 실제 게임을 그대로 플레이하므로, 시연 중에는
// 진행(코인·기억·최고 층·일일 기록 등)이 세이브에 남지 않게 쓰기만 막는다.
// 읽기·React 상태는 정상 동작하므로 시연은 자연스럽게 굴러가고,
// 시연이 끝나면 리로드해서 원래 세이브 그대로 복귀한다 (App: startDemo/DemoEndScreen).
// 음소거(d100-muted)는 사용자 설정이라 sound.ts에서 직접 저장 — 이 스위치와 무관.
let persistenceSuspended = false;
export function suspendPersistence(on: boolean) {
  persistenceSuspended = on;
}

// localStorage 연동 useState. 키는 모두 'd100-' 접두사 사용.
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        if (!persistenceSuspended) localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 사생활 보호 모드 등에서 저장 실패는 무시
      }
      return next;
    });
  };
  return [value, set] as const;
}
