import { ALL_UPGRADES } from './upgrades';

// 도감 「채워지는 책」 (2026-07-24) — 만난 몬스터·얻은 아이템·본 사건이 책의 페이지로 기록된다.
// 세계관과 정확히 일치: 던전은 쓰이다 만 책이고, 모험이 그 책을 채운다.
// Isaac류 '발견의 광맥' — 런 밖에서 쌓이는 장기 수집 후크. 저장: localStorage `d100-dex`.

export interface DexState {
  items: string[]; // 얻어 본 업그레이드 id (진화 포함)
  mobs: string[]; // 만난(처치한) 몬스터 종류
  events: string[]; // 겪어 본 사건
}

export const EMPTY_DEX: DexState = { items: [], mobs: [], events: [] };

export interface DexEntry {
  id: string;
  icon: string;
  name: string;
  desc: string;
}

export const DEX_MOBS: DexEntry[] = [
  { id: 'chaser', icon: '🟥', name: '쫓는 것', desc: '우직하게 다가온다. 첫 페이지의 몬스터.' },
  { id: 'shooter', icon: '🔶', name: '겨누는 것', desc: '거리를 두고 잉크 방울을 쏜다.' },
  { id: 'dasher', icon: '🔷', name: '덮치는 것', desc: '부들부들 조준하다가 단숨에 덮친다.' },
  { id: 'tank', icon: '⬛', name: '무거운 것', desc: '느리지만 단단하다. 밀리지도 않는다.' },
  { id: 'elite', icon: '🟪', name: '출구 수문장', desc: '문 앞을 지키는 진홍빛 정예.' },
  { id: 'boss', icon: '📖', name: '페이지의 수호자', desc: '10층마다 포털을 봉인한다 — 세 가지 얼굴을 가졌다.' },
];

export const DEX_EVENTS: DexEntry[] = [
  { id: 'altar', icon: '🕯️', name: '낡은 제단', desc: '「피를 잉크로.」 체력을 바치면 보물을 준다.' },
  { id: 'house', icon: '👹', name: '몬스터 하우스', desc: '붉게 물든 방 — 위험과 코인이 함께 쏟아진다.' },
  { id: 'secret', icon: '📄', name: '찢어진 페이지', desc: '몇 장을 그냥 넘겨 버릴 수 있다.' },
  { id: 'rift', icon: '🌫️', name: '두 갈래 틈', desc: '층 안의 먼 곳과 이어진 접힌 틈.' },
  { id: 'homedoor', icon: '🚪', name: '책갈피 문', desc: '5층마다 나타나는 마을로 가는 문.' },
  { id: 'peddler', icon: '🎩', name: '떠돌이 상인', desc: '바퀴 없는 마차의 주인. 그도 떨어진 사람이었다.' },
  { id: 'trace', icon: '🕊️', name: '소녀의 흔적', desc: '낙서, 종이학, 초대장… 누군가 여기 살고 있다.' },
  { id: 'girl', icon: '🫖', name: '56층의 찻자리', desc: '이름이 빈칸인 소녀와 마신 차 한 잔.' },
];

export const dexTotal = () => ALL_UPGRADES.length + DEX_MOBS.length + DEX_EVENTS.length;

export const dexCount = (d: DexState) =>
  new Set(d.items).size + new Set(d.mobs).size + new Set(d.events).size;

export const dexPct = (d: DexState) => Math.floor((dexCount(d) / dexTotal()) * 100);

// 수집률 마일스톤 — 달성 시 1회성 코인 보상 (도감이 메타 성장에도 닿게)
export const DEX_MILESTONES = [
  { pct: 25, coins: 50 },
  { pct: 50, coins: 100 },
  { pct: 75, coins: 150 },
  { pct: 100, coins: 250 },
];
