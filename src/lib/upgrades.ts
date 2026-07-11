// 층 클리어 보상 드래프트 — 3장 중 1장을 골라 빌드를 쌓는 로그라이크 훅.
export interface Stats {
  maxHp: number;
  damage: number;
  fireRate: number; // 초당 발사 수
  range: number; // 월드 단위
  speed: number;
  shots: number; // 동시 투사체 수
}

export const BASE_STATS: Stats = {
  maxHp: 100,
  damage: 10,
  fireRate: 2,
  range: 9,
  speed: 7,
  shots: 1,
};

export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  desc: string;
  apply: (s: Stats) => Stats;
}

export const UPGRADES: Upgrade[] = [
  { id: 'dmg', icon: '⚔️', name: '공격력 강화', desc: '공격력 +25%', apply: (s) => ({ ...s, damage: s.damage * 1.25 }) },
  { id: 'rate', icon: '⚡', name: '연사 가속', desc: '공격 속도 +20%', apply: (s) => ({ ...s, fireRate: s.fireRate * 1.2 }) },
  { id: 'speed', icon: '👟', name: '신속의 장화', desc: '이동 속도 +12%', apply: (s) => ({ ...s, speed: s.speed * 1.12 }) },
  { id: 'hp', icon: '💖', name: '생명의 심장', desc: '최대 체력 +25 (즉시 회복)', apply: (s) => ({ ...s, maxHp: s.maxHp + 25 }) },
  { id: 'range', icon: '🎯', name: '매의 눈', desc: '사거리 +15%', apply: (s) => ({ ...s, range: s.range * 1.15 }) },
  { id: 'multi', icon: '🔱', name: '멀티샷', desc: '투사체 +1', apply: (s) => ({ ...s, shots: s.shots + 1 }) },
];

export function draftThree(rand: () => number): Upgrade[] {
  const pool = [...UPGRADES];
  const picks: Upgrade[] = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  }
  return picks;
}
