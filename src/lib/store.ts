import { useState } from 'react';

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
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // 사생활 보호 모드 등에서 저장 실패는 무시
      }
      return next;
    });
  };
  return [value, set] as const;
}
