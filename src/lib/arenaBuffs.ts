import type { Stats, Upgrade } from './upgrades';
import { SPEED_CAP } from './upgrades';

// ── 아레나 임시 버프 (2026-07-25) — 몬스터 아레나 안에서만 사는 「그 판 한정」 강화.
//
// 왜 따로 두는가: 층 돌파 드래프트(3택 1)는 판 전체를 관통하는 '빌드'라 신중해지는 선택이고,
// 이건 보석을 주울 때마다 2택 1로 즉시 소비되는 '지금 이 무리를 어떻게 뚫을까'의 선택이다.
// 아레나를 나가면 전부 사라지므로 과감하게 세게 잡았다(복리 걱정 없음 — 본체 빌드 불변).
//
// build(빌드 칩·진화 조합·도감)에는 절대 안 들어간다: 적용 대상은 아레나 전용 Stats 사본뿐.
// 그래서 id에 `ab_` 접두사를 붙여 UPGRADES의 id와 절대 안 겹치게 한다.
export const ARENA_BUFFS: Upgrade[] = [
  { id: 'ab_rage', icon: '⚔️', name: '맹공', desc: '이번 아레나 — 공격력 +45%', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, damage: s.damage * 1.45 }) },
  { id: 'ab_haste', icon: '⚡', name: '폭주', desc: '이번 아레나 — 공격 속도 +40%', rarity: 'common', tag: '공격', apply: (s) => ({ ...s, fireRate: s.fireRate * 1.4 }) },
  { id: 'ab_split', icon: '🔱', name: '분열', desc: '이번 아레나 — 투사체 +1', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, shots: s.shots + 1 }) },
  { id: 'ab_crit', icon: '💢', name: '급소', desc: '이번 아레나 — 치명타 +25%', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, crit: Math.min(0.6, s.crit + 0.25) }) },
  { id: 'ab_pierce', icon: '🗡️', name: '꿰뚫기', desc: '이번 아레나 — 투사체가 적 1기를 관통', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, pierce: s.pierce + 1 }) },
  { id: 'ab_boom', icon: '💥', name: '파열', desc: '이번 아레나 — 처치 시 폭발 피해 +22', rarity: 'rare', tag: '공격', apply: (s) => ({ ...s, boom: s.boom + 22 }) },
  { id: 'ab_dash', icon: '👟', name: '질주', desc: '이번 아레나 — 이동 속도 증가', rarity: 'common', tag: '보조', apply: (s) => ({ ...s, speed: s.speed + Math.max(0, (SPEED_CAP - s.speed) * 0.35) }) },
  { id: 'ab_guard', icon: '🛡️', name: '방벽', desc: '이번 아레나 — 받는 피해 감소', rarity: 'common', tag: '생존', apply: (s) => ({ ...s, armor: s.armor + (0.5 - s.armor) * 0.4 }) },
  { id: 'ab_drain', icon: '🩸', name: '갈증', desc: '이번 아레나 — 처치 시 체력 +6', rarity: 'rare', tag: '생존', apply: (s) => ({ ...s, lifesteal: s.lifesteal + 6 }) },
  { id: 'ab_push', icon: '🌪️', name: '밀치기', desc: '이번 아레나 — 넉백 +90%', rarity: 'common', tag: '보조', apply: (s) => ({ ...s, knock: s.knock + 0.9 }) },
];

// 2택 1 — 서로 다른 두 장을 시드 난수로 뽑는다.
// 시드를 쓰는 이유: 같은 상황이면 같은 선택지가 나와야 밸런스 봇 실측이 재현된다.
export function pickArenaBuffs(rand: () => number, taken: string[] = []): Upgrade[] {
  const pool = ARENA_BUFFS.filter((b) => !taken.includes(b.id));
  const src = pool.length >= 2 ? pool : [...ARENA_BUFFS];
  const picks: Upgrade[] = [];
  const rest = [...src];
  for (let i = 0; i < 2 && rest.length > 0; i++) {
    picks.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  }
  return picks;
}

// 아레나에 들어갈 때 쓰는 스탯 = 본체 빌드 + 이번 아레나에서 고른 임시 버프들
export function applyArenaBuffs(base: Stats, buffs: Upgrade[]): Stats {
  return buffs.reduce((s, b) => b.apply(s), base);
}
