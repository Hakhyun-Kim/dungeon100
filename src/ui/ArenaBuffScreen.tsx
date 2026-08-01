import type { Upgrade } from '../lib/upgrades';
import { ChoiceList } from './Menu';

// 아레나 임시 버프 2택 1 — 보석을 하나 주울 때마다 열린다.
// 층 드래프트(3택 1, 판 전체)와 달리 '이번 아레나에서만' 사는 즉흥 결정이라 2택으로 짧게 끊는다.
// 몬스터 하우스(2026-07-27)도 같은 훅을 쓴다 — variant로 문구만 바꾼다(선택 로직은 동일).
export default function ArenaBuffScreen({
  gems,
  choices,
  onPick,
  variant = 'arena',
}: {
  gems: number; // 지금까지 주운 보석/동전 수 (1 또는 2)
  choices: Upgrade[];
  onPick: (u: Upgrade) => void;
  variant?: 'arena' | 'house';
}) {
  const title = variant === 'house' ? `🪙 동전 무더기 ${gems}개째 — 힘이 잠깐 깃든다` : `💎 보석 ${gems}개째 — 힘이 잠깐 깃든다`;
  const sub =
    variant === 'house'
      ? '이번 층 동안만 유효해요. 우르르 몰린 무리를 어떻게 뚫을까요?'
      : '이번 아레나 동안만 유효해요. 남은 무리를 어떻게 뚫을까요?';
  return (
    <div className="screen draft-screen arena-buff-screen">
      <h2>{title}</h2>
      <p className="quiz-sub">{sub}</p>
      <ChoiceList
        kind="card"
        items={choices.map((u) => ({
          key: u.id,
          className: `rarity-${u.rarity} temp`,
          label: (
            <>
              <span className="card-icon">{u.icon}</span>
              <span className="card-name">{u.name}</span>
              <span className="card-desc">{u.desc}</span>
              <span className="card-tag">⏳ 임시</span>
            </>
          ),
          onPick: () => onPick(u),
        }))}
      />
    </div>
  );
}
