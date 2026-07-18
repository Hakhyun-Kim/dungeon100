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

// 이동 속도 소프트 캡 — 곱연산(×1.12)은 픽마다 절대 증가량이 커져 고속에서 던전 조작이 불편.
// 캡까지 남은 거리의 15%씩만 올려 뒤로 갈수록 완만해진다 (7 → 7.75 → 8.39 → … → 12).
export const SPEED_CAP = 12;
// 사거리 소프트 캡 — 복리(×1.15)로 늘면 금방 적 어그로권(9)·슈터 사거리(11)를 넘어서
// 위험권 밖 안전 저격이 됐다. 캡 13 = 보스 교전 반경(16)·탄막 도달(15)보다 안쪽 —
// 보스를 때리려면 반드시 탄막 안에 서 있어야 한다 (2026-07-18 밸런스 패스).
export const RANGE_CAP = 13;

// 공격력·연사도 복리(×1.25/×1.2)는 층당 최대 4아이템 유입과 겹쳐 DPS가 보스 HP(선형)를
// 압도했다 — 배율을 낮춰 성장은 유지하되 복리 폭주만 완화 (같은 밸런스 패스).
export const UPGRADES: Upgrade[] = [
  { id: 'dmg', icon: '⚔️', name: '공격력 강화', desc: '공격력 +18%', apply: (s) => ({ ...s, damage: s.damage * 1.18 }) },
  { id: 'rate', icon: '⚡', name: '연사 가속', desc: '공격 속도 +14%', apply: (s) => ({ ...s, fireRate: s.fireRate * 1.14 }) },
  { id: 'speed', icon: '👟', name: '신속의 장화', desc: '이동 속도 증가 — 빠를수록 완만 (최대 12)', apply: (s) => ({ ...s, speed: s.speed + Math.max(0, (SPEED_CAP - s.speed) * 0.15) }) },
  { id: 'hp', icon: '💖', name: '생명의 심장', desc: '최대 체력 +25 (즉시 회복)', apply: (s) => ({ ...s, maxHp: s.maxHp + 25 }) },
  { id: 'range', icon: '🎯', name: '매의 눈', desc: '사거리 증가 — 멀수록 완만 (최대 13)', apply: (s) => ({ ...s, range: s.range + Math.max(0, (RANGE_CAP - s.range) * 0.15) }) },
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
