// 층 클리어 보상 드래프트 — 3장 중 1장을 골라 빌드를 쌓는 로그라이크 훅.
export interface Stats {
  maxHp: number;
  damage: number;
  fireRate: number; // 초당 발사 수
  range: number; // 월드 단위
  speed: number;
  shots: number; // 동시 투사체 수
  crit: number; // 치명타 확률 (명중 시 2배 피해, 최대 0.6)
  lifesteal: number; // 처치 시 회복량 (HP)
  armor: number; // 받는 피해 감소율 (겹칠수록 완만, 최대 0.5)
  dodge: number; // 피격 회피 확률 (최대 0.45)
  greed: number; // 코인 획득 배율
  boom: number; // 처치 폭발 피해 (0 = 없음, 반경 2.4)
  thorns: number; // 접촉한 적에게 주는 반사 피해
  knock: number; // 넉백 배율
  shotSpeed: number; // 투사체 속도 배율
  pierce: number; // 투사체 관통 횟수
}

export const BASE_STATS: Stats = {
  maxHp: 100,
  damage: 10,
  fireRate: 2,
  range: 9,
  speed: 7,
  shots: 1,
  crit: 0,
  lifesteal: 0,
  armor: 0,
  dodge: 0,
  greed: 1,
  boom: 0,
  thorns: 0,
  knock: 1,
  shotSpeed: 1,
  pierce: 0,
};

// 희귀도 — 드래프트·보물 모두 가중 등장 (전설은 귀하다)
export type Rarity = 'common' | 'rare' | 'legendary';
// 시너지 태그 — 같은 태그를 2개 이상 모으면 드래프트가 그 태그를 밀어준다 (빌드 형성 돕기)
export type UpgradeTag = '공격' | '생존' | '보조';

export interface Upgrade {
  id: string;
  icon: string;
  name: string;
  desc: string;
  rarity: Rarity;
  tag: UpgradeTag;
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
  { id: 'dmg', icon: '⚔️', name: '공격력 강화', desc: '공격력 +18%', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, damage: s.damage * 1.18 }) },
  { id: 'rate', icon: '⚡', name: '연사 가속', desc: '공격 속도 +14%', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, fireRate: s.fireRate * 1.14 }) },
  { id: 'speed', icon: '👟', name: '신속의 장화', desc: '이동 속도 증가 — 빠를수록 완만 (최대 12)', rarity: 'common', tag: '보조', apply: (s) => ({ ...s, speed: s.speed + Math.max(0, (SPEED_CAP - s.speed) * 0.15) }) },
  { id: 'hp', icon: '💖', name: '생명의 심장', desc: '최대 체력 +25 (즉시 회복)', rarity: 'common', tag: '생존', apply: (s) => ({ ...s, maxHp: s.maxHp + 25 }) },
  { id: 'range', icon: '🎯', name: '매의 눈', desc: '사거리 증가 — 멀수록 완만 (최대 13)', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, range: s.range + Math.max(0, (RANGE_CAP - s.range) * 0.15) }) },
  { id: 'multi', icon: '🔱', name: '멀티샷', desc: '투사체 +1', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, shots: s.shots + 1 }) },
  // ── 확장 풀 (2026-07-19): 희귀도·시너지 태그와 함께 10종 추가
  { id: 'crit', icon: '💢', name: '급소 일격', desc: '치명타 +15% (2배 피해, 최대 60%)', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, crit: Math.min(0.6, s.crit + 0.15) }) },
  { id: 'boom', icon: '💥', name: '폭발 구슬', desc: '처치 시 폭발 — 주변 적에게 피해 +14', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, boom: s.boom + 14 }) },
  { id: 'shotspd', icon: '🏹', name: '시위 강화', desc: '투사체 속도 +25%', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, shotSpeed: s.shotSpeed + 0.25 }) },
  { id: 'pierce', icon: '🗡️', name: '관통 서표', desc: '투사체가 적 1기를 관통', rarity: 'legendary', tag: '공격', apply: (s) => ({ ...s, pierce: s.pierce + 1 }) },
  { id: 'armor', icon: '🛡️', name: '단단한 표지', desc: '받는 피해 감소 — 겹칠수록 완만 (최대 50%)', rarity: 'common', tag: '생존', apply: (s) => ({ ...s, armor: s.armor + (0.5 - s.armor) * 0.25 }) },
  { id: 'dodge', icon: '💨', name: '잔상 회피', desc: '피격 회피 +15% (최대 45%)', rarity: 'rare', tag: '생존', apply: (s) => ({ ...s, dodge: Math.min(0.45, s.dodge + 0.15) }) },
  { id: 'steal', icon: '🩸', name: '흡혈의 잉크', desc: '적 처치 시 체력 +3', rarity: 'rare', tag: '생존', apply: (s) => ({ ...s, lifesteal: s.lifesteal + 3 }) },
  { id: 'thorns', icon: '🌵', name: '가시 문장', desc: '접촉한 적에게 반사 피해 +8', rarity: 'rare', tag: '생존', apply: (s) => ({ ...s, thorns: s.thorns + 8 }) },
  { id: 'greed', icon: '🪙', name: '탐욕의 책갈피', desc: '처치 코인 +30%', rarity: 'common', tag: '보조', apply: (s) => ({ ...s, greed: s.greed + 0.3 }) },
  { id: 'knock', icon: '🌪️', name: '밀어내기', desc: '넉백 +40%', rarity: 'common', tag: '보조', apply: (s) => ({ ...s, knock: s.knock + 0.4 }) },
];

const RARITY_WEIGHT: Record<Rarity, number> = { common: 1, rare: 0.5, legendary: 0.22 };

// 빌드에서 2개 이상 모인 태그 — 드래프트·보물이 그 태그를 살짝 밀어준다 (×1.35)
export function synergyTags(build?: Record<string, number>): Set<UpgradeTag> {
  const tags = new Set<UpgradeTag>();
  if (!build) return tags;
  const count = new Map<UpgradeTag, number>();
  for (const u of UPGRADES) {
    if (build[u.id]) count.set(u.tag, (count.get(u.tag) ?? 0) + build[u.id]);
  }
  for (const [tag, n] of count) if (n >= 2) tags.add(tag);
  return tags;
}

// 희귀도(+태그 시너지) 가중 뽑기 — pool에서 하나를 꺼내 반환
function pullWeighted(rand: () => number, pool: Upgrade[], boost: Set<UpgradeTag>): Upgrade {
  const ws = pool.map((u) => RARITY_WEIGHT[u.rarity] * (boost.has(u.tag) ? 1.35 : 1));
  let r = rand() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= ws[i];
    if (r <= 0) return pool.splice(i, 1)[0];
  }
  return pool.pop()!;
}

export function draftThree(rand: () => number, build?: Record<string, number>): Upgrade[] {
  return pickUpgrades(rand, 3, build);
}

// 보물·선물·보스 보상 공용 — n개 중복 없이 가중 뽑기
export function pickUpgrades(
  rand: () => number,
  n: number,
  build?: Record<string, number>,
): Upgrade[] {
  const pool = [...UPGRADES];
  const boost = synergyTags(build);
  const picks: Upgrade[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) picks.push(pullWeighted(rand, pool, boost));
  return picks;
}
