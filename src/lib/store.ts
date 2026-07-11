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
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // 사생활 보호 모드 등에서 저장 실패는 무시
    }
  };
  return [value, set] as const;
}
