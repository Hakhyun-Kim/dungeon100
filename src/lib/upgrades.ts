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
  // ── 진화 「합본」 효과 (2026-07-24) — 숫자가 아니라 '행동'을 바꾼다
  fanEvery: number; // N번째 공격마다 부채꼴 9연발 (0 = 없음)
  bounce: number; // 투사체 벽 반사 횟수
  critBoom: number; // 치명타 시 대폭발 (0/1)
  shockwave: number; // 피격 시 충격파 (0/1)
  royalty: number; // 코인 획득 시 회복 (0/1)
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
  fanEvery: 0,
  bounce: 0,
  critBoom: 0,
  shockwave: 0,
  royalty: 0,
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
  evo?: boolean; // 진화 「합본」 카드 (전용 연출·판당 1회)
  expiresIn?: number; // 있으면 '휘발되는 장' 카드 — 이 층 수만큼 지나면 자동으로 사라진다
  revert?: (s: Stats) => Stats; // expiresIn 카드 전용 — apply의 정확한 역연산 (반드시 짝을 맞출 것)
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
// 압도했다 — 배율을 낮춰 성장은 유지하되 복리 폭주만 완화 (2026-07-18 밸런스 패스).

// ── 공격력·연사 소프트 캡 (2026-07-25)
// 배율을 낮춰도 곱연산은 여전히 복리라, 사람형 봇 실측에서 50층에 195아이템으로 무저항
// 순항했다(사망 0). 적 HP는 선형(18+층×7)인데 DPS만 지수로 자라니 층이 의미를 잃는다.
//
// 그래서 '증가폭이 이미 쌓인 값에 반비례해 줄어드는' 형태로 바꾼다. 초반엔 예전과 거의
// 같게 오르지만(체감 유지), 크게 쌓이면 카드당 증가가 상수에 수렴해 **성장이 선형이 된다** —
// 적 HP도 선형이므로 둘의 비율이 유지되고, 층이 계속 의미를 갖는다.
// 이동 속도·사거리에 이미 쓰던 소프트 캡과 같은 사상이되, 절대 상한이 없어 깊은 층에서
// 성장이 멈추지는 않는다 (상한을 두면 적 스탯 램프와 겹쳐 진행 불가가 된다).
export const DMG_SOFT = 60; // 이 규모를 넘으면 카드당 증가가 +10.8 근처로 수렴
export const RATE_SOFT = 6;
export const dmgStep = (d: number) => d * (0.18 / (1 + d / DMG_SOFT));
export const rateStep = (r: number) => r * (0.14 / (1 + r / RATE_SOFT));
export const UPGRADES: Upgrade[] = [
  { id: 'dmg', icon: '⚔️', name: '공격력 강화', desc: '공격력 증가 — 쌓일수록 완만', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, damage: s.damage + dmgStep(s.damage) }) },
  { id: 'rate', icon: '⚡', name: '연사 가속', desc: '공격 속도 증가 — 쌓일수록 완만', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, fireRate: s.fireRate + rateStep(s.fireRate) }) },
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

// ── 휘발되는 장 (2026-07-29) — "즉시 강하지만 곧 사라지는 자원". 드래프트 카드 자체가
//    낮은 확률로 나와, 뽑으면 즉시 아주
//    강력한 효과를 주지만 몇 층 뒤 자동으로 사라진다 — "지금 당겨 쓸까, 아껴서 다른 카드를
//    기다릴까"라는 드래프트 순간의 새로운 트레이드오프. 스탯이 아니라 '플레이 방식'을 바꾸는
//    진화 합본과는 반대 축이다(합본=영구·조건부, 휘발=즉시·시한부).
//    revert는 apply의 정확한 역연산이어야 한다 — 소프트 캡 함수(dmgStep 등)를 타는 스탯은
//    되돌릴 때 다른 픽으로 이미 값이 바뀌어 있어 역연산이 부정확해지므로 쓰지 않는다. 대신
//    소프트 캡과 무관한 '고정 수치'만 더하고 그대로 빼 — 사이에 다른 카드를 몇 개를 더 집어도
//    덧셈·뺄셈의 결합·교환 법칙 덕에 항상 정확히 상쇄된다.
export const VOLATILE_WEIGHT = 0.15; // 드래프트 가중치 — legendary(0.22)보다도 낮게 잡아 귀하게
export const VOLATILE_UPGRADES: Upgrade[] = [
  {
    id: 'v_ink', icon: '🖋️', name: '찢어진 낱장 — 격정의 필사', tag: '공격', rarity: 'legendary',
    desc: '공격력 +40 (강력하지만 3층 뒤 소멸)', expiresIn: 3,
    apply: (s) => ({ ...s, damage: s.damage + 40 }),
    revert: (s) => ({ ...s, damage: Math.max(BASE_STATS.damage, s.damage - 40) }),
  },
  {
    id: 'v_haste', icon: '🌀', name: '찢어진 낱장 — 질주하는 필체', tag: '공격', rarity: 'legendary',
    desc: '연사 속도 +2.5 (강력하지만 3층 뒤 소멸)', expiresIn: 3,
    apply: (s) => ({ ...s, fireRate: s.fireRate + 2.5 }),
    revert: (s) => ({ ...s, fireRate: Math.max(BASE_STATS.fireRate, s.fireRate - 2.5) }),
  },
];

export interface ExpiringBuff {
  id: string;
  floor: number; // 이 카드를 획득한 시점의 층 번호
}

// 휘발 카드 만료 처리 — 순수 함수. 층이 바뀔 때마다(DungeonScene/GemArenaScene의 층 전환
// 이벤트를 받아 App이) 호출해, expiresIn을 넘긴 항목만 stats에서 정확히 되돌린다.
// build 카운트도 App이 같이 내려야 한다(도감·BuildRow 칩이 안 남은 효과를 계속 보여주지 않게).
export function expireVolatile(
  expiring: ExpiringBuff[],
  stats: Stats,
  floorNo: number,
): { stats: Stats; expiring: ExpiringBuff[]; expired: Upgrade[] } {
  let s = stats;
  const remain: ExpiringBuff[] = [];
  const expired: Upgrade[] = [];
  for (const e of expiring) {
    const u = VOLATILE_UPGRADES.find((v) => v.id === e.id);
    if (!u || !u.revert || u.expiresIn == null) continue; // 정의가 없어졌으면 조용히 버림(방어적)
    if (floorNo - e.floor >= u.expiresIn) {
      s = u.revert(s);
      expired.push(u);
    } else {
      remain.push(e);
    }
  }
  return { stats: s, expiring: remain, expired };
}

// ── 진화 「합본」 (2026-07-24) — 특정 조합을 모으면 다음 드래프트 첫 슬롯에 확정 등장하는
//    금빛 카드. 스탯 복리가 아니라 '플레이 방식'을 바꾼다 (VS류 진화의 잿팟 순간). 판당 각 1회.
//    세계관: 되찾은 페이지 두 묶음이 합쳐져 '개정 합본'으로 다시 쓰인다.
export interface Evolution extends Upgrade {
  evo: true;
  recipe: string; // 카드에 보여줄 조합 (달성 조건)
  req: Record<string, number>; // 조합 재료 — 카드 id별 필요 장수 (달성 판정·힌트 칩 공용)
}

export const EVOLUTIONS: Evolution[] = [
  {
    id: 'evo_verse', icon: '🌊', name: '쏟아지는 문장', recipe: '🔱 멀티샷×2 + ⚡ 연사×2',
    desc: '네 번째 공격마다 문장이 쏟아진다 — 부채꼴 9연발', rarity: 'legendary', tag: '공격', evo: true,
    req: { multi: 2, rate: 2 },
    apply: (s) => ({ ...s, fanEvery: 4 }),
  },
  {
    id: 'evo_shuriken', icon: '📄', name: '종이 표창', recipe: '🗡️ 관통 서표 + 🏹 시위 강화×2',
    desc: '투사체가 벽에 한 번 튕겨 계속 난다', rarity: 'legendary', tag: '공격', evo: true,
    req: { pierce: 1, shotspd: 2 },
    apply: (s) => ({ ...s, bounce: s.bounce + 1 }),
  },
  {
    id: 'evo_period', icon: '⭕', name: '마침표', recipe: '💥 폭발 구슬 + 💢 급소 일격×2',
    desc: '치명타가 대폭발을 새긴다 — 문장의 끝', rarity: 'legendary', tag: '공격', evo: true,
    req: { boom: 1, crit: 2 },
    apply: (s) => ({ ...s, critBoom: 1 }),
  },
  {
    id: 'evo_binding', icon: '📕', name: '단단한 장정', recipe: '🌵 가시 문장 + 🛡️ 단단한 표지×2',
    desc: '맞는 순간 충격파 — 주변을 밀쳐내고 벤다', rarity: 'legendary', tag: '생존', evo: true,
    req: { thorns: 1, armor: 2 },
    apply: (s) => ({ ...s, shockwave: 1 }),
  },
  {
    id: 'evo_royalty', icon: '💰', name: '인세', recipe: '🩸 흡혈의 잉크 + 🪙 탐욕의 책갈피',
    desc: '코인이 들어올 때마다 체력 +2', rarity: 'legendary', tag: '보조', evo: true,
    req: { steal: 1, greed: 1 },
    apply: (s) => ({ ...s, royalty: 1 }),
  },
];

// ── 정예의 증표 (2026-07-30) — "강한 적을 잡으면 그 적의 시그니처 능력이 내 덱에 들어온다".
//    출구 수문장은 원래도 봉인 없는 선택적 전투라 "위험을 감수
//    하고 잡을까, 그냥 지나칠까"라는 결정이 있었는데(docs/DESIGN.md), 보상이 코인 12뿐이라
//    그 결정의 무게가 가벼웠다. 그렇다고 수문장은 4층부터 거의 매 층에 서 있으므로 처치마다
//    아이템을 주면 안 그래도 미해결 과제인 "성장은 복리, 위협은 선형" 스노볼을 더 키운다
//    (docs/DESIGN.md 로드맵 참조) — 그래서 지급을 **판당 첫 처치 1회**로 못박아 economy에
//    미치는 영향을 런당 +1로 한정했다. 일반 드래프트·보물 풀(pickUpgrades)에는 안 섞인다 —
//    수문장을 잡아야만 나오는 전용 보상이라는 정체성이 흐려지지 않게.
//    ⚠️ **지급 시점은 처치 순간이 아니다** — App.tsx의 onKill은 판정만 표시(ref 플래그)하고
//    실제 apply는 onExit(포털 통과)로 미룬다. 실측(2026-07-30): 처치 즉시 gainUpgrade를
//    부르게 했더니 하드런 사망 중앙값이 8→4로 무너졌다 — 수문장은 다른 적과 뒤엉킨 채 죽는
//    경우가 많아, 그 프레임에 무거운 리렌더(스탯+빌드+도감 갱신 setState 묶음)가 겹치면
//    실전투 중 프레임이 튀어 접촉 피해 판정이 불안정해졌다. 수문장은 포털 바로 앞을 지키므로
//    처치 직후 곧 포털로 들어가게 되고, 그 순간은 이미 층 전환이 시작돼 실전투가 아니다 —
//    같은 자리에서 이미 안전하게 지급 중이던 「무너지는 서가」 보상과 동일한 패턴.
export const ELITE_SIGNATURE: Upgrade = {
  id: 'elite_mark',
  icon: '🔥',
  name: '정예의 증표',
  desc: '수문장의 힘을 이어받는다 — 공격력 +16 · 방어 +12%(최대 50%). 판당 첫 수문장 처치 전용.',
  rarity: 'legendary',
  tag: '공격',
  apply: (s) => ({
    ...s,
    damage: s.damage + 16,
    armor: Math.min(0.5, s.armor + (0.5 - s.armor) * 0.3),
  }),
};

// 빌드 칩·도감 등 표시용 전체 풀 (랜덤 뽑기 풀에는 진화가 안 섞인다 — 조건 달성 시 확정 등장)
export const ALL_UPGRADES: Upgrade[] = [
  ...UPGRADES,
  ...VOLATILE_UPGRADES,
  ...EVOLUTIONS,
  ELITE_SIGNATURE,
];

const metReq = (req: Record<string, number>, b: Record<string, number>) =>
  Object.entries(req).every(([id, n]) => (b[id] ?? 0) >= n);

// 조건을 달성했지만 아직 안 가진 진화
export function eligibleEvolutions(build?: Record<string, number>): Evolution[] {
  if (!build) return [];
  return EVOLUTIONS.filter((e) => !build[e.id] && metReq(e.req, build));
}

// 드래프트 카드 힌트 — 이 카드를 집으면 어느 합본에 가까워지나.
// 진화 시스템의 존재를 첫 판 첫 드래프트부터 보여 주는 장치: 카드가 조합 재료면
// '가장 가까운' 합본과 (이 카드를 집은 뒤) 남은 장수를 돌려준다. 재료가 아니면 null.
export function evoHintFor(
  u: Upgrade,
  build: Record<string, number>,
): { evo: Evolution; remain: number } | null {
  if (u.evo) return null;
  let best: { evo: Evolution; remain: number } | null = null;
  for (const e of EVOLUTIONS) {
    if (build[e.id]) continue; // 이미 완성한 합본
    const needThis = e.req[u.id];
    if (!needThis || (build[u.id] ?? 0) >= needThis) continue; // 이 카드로는 진전이 없다
    const remain =
      Object.entries(e.req).reduce((s, [id, n]) => s + Math.max(0, n - (build[id] ?? 0)), 0) - 1;
    if (!best || remain < best.remain) best = { evo: e, remain };
  }
  return best;
}

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
// 휘발 카드는 희귀도 대신 고정된 VOLATILE_WEIGHT를 쓴다(legendary보다도 낮게) — 시너지 부스트도
// 받지 않는다(어차피 몇 층 뒤 사라질 카드가 태그 시너지까지 밀어주면 드래프트가 과하게 흔들린다).
function pullWeighted(rand: () => number, pool: Upgrade[], boost: Set<UpgradeTag>): Upgrade {
  const ws = pool.map((u) =>
    u.expiresIn != null ? VOLATILE_WEIGHT : RARITY_WEIGHT[u.rarity] * (boost.has(u.tag) ? 1.35 : 1),
  );
  let r = rand() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= ws[i];
    if (r <= 0) return pool.splice(i, 1)[0];
  }
  return pool.pop()!;
}

export function draftThree(
  rand: () => number,
  build?: Record<string, number>,
  premium = false, // 갈림길 「모험의 길」 보상 — 3장 전부 레어 이상
): Upgrade[] {
  const picks = pickUpgrades(rand, 3, build, premium);
  // 진화 「합본」 — 조건을 달성했으면 첫 슬롯에 확정 등장 (잿팟은 놓치지 않게)
  const evos = eligibleEvolutions(build);
  if (evos.length > 0) picks[0] = evos[Math.floor(rand() * evos.length)];
  return picks;
}

// 보물·선물·보스 보상 공용 — n개 중복 없이 가중 뽑기
export function pickUpgrades(
  rand: () => number,
  n: number,
  build?: Record<string, number>,
  premium = false,
): Upgrade[] {
  const basePool = [...UPGRADES, ...VOLATILE_UPGRADES]; // 휘발 카드도 같은 지급 경로를 공유
  const pool = premium ? basePool.filter((u) => u.rarity !== 'common') : basePool;
  const boost = synergyTags(build);
  const picks: Upgrade[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) picks.push(pullWeighted(rand, pool, boost));
  return picks;
}
