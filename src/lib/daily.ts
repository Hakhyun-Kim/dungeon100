// 일일 던전 — 오늘 날짜가 시드. 모두가 같은 맵, 같은 문제(어른 던전 고정)에 도전한다.
// 층=시드 구조를 그대로 재사용: 날짜 시드를 층 시드에 섞으면 그날만의 던전 100층이 생긴다.
// (적 타입 구성·아이템 뽑기 일부는 Math.random이라 완전 동일하진 않음 — 기록 기준은 도달 층수)

export const todayKey = (): string => {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};

// 날짜 문자열 → 시드 정수 (층 레이아웃·드래프트·문제 시드에 섞는다)
export const dailySeed = (key: string): number => {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h >>> 1; // 양수 보장
};

// localStorage d100-daily — 오늘의 최고 기록 (날짜가 바뀌면 새 도전)
export interface DailyRecord {
  date: string;
  floor: number;
  cleared?: boolean;
}
