import { BASE_STATS, SPEED_CAP } from './upgrades';

// 대장간 영구 강화 (죽어도 유지 — localStorage d100-meta)
export interface Meta {
  dmg: number;
  hp: number;
  spd: number;
}

// 레벨 상한 없음 — 비용이 (lv+1)×25로 계속 오르는 무한 단련. 신속만 소프트 캡(아래 metaSpeed).
export const SHOP_ITEMS: { key: keyof Meta; icon: string; name: string; desc: string }[] = [
  { key: 'dmg', icon: '⚔️', name: '공격 단련', desc: '시작 공격력 +2' },
  { key: 'hp', icon: '💖', name: '생명 단련', desc: '시작 체력 +15' },
  { key: 'spd', icon: '👟', name: '신속 단련', desc: '시작 이동 증가 (갈수록 완만)' },
];

export const shopCost = (lv: number) => (lv + 1) * 25;

// 신속 단련은 레벨당 캡까지 남은 거리의 8%씩 — 1레벨은 예전과 같은 +0.4, 무한 구매해도 캡(12) 안쪽.
export const metaSpeed = (lv: number) =>
  SPEED_CAP - (SPEED_CAP - BASE_STATS.speed) * Math.pow(0.92, lv);
