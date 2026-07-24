import { evoHintFor, type Upgrade } from '../lib/upgrades';
import { ChoiceList } from './Menu';

// 층 돌파 보상 드래프트 — 3장 중 1장 선택
export default function DraftScreen({
  floorNo,
  draft,
  build,
  onPick,
}: {
  floorNo: number;
  draft: Upgrade[];
  build: Record<string, number>; // 진화 조합 힌트 계산용 (현재 보유 카드)
  onPick: (u: Upgrade) => void;
}) {
  return (
    <div className="screen draft-screen">
      <h2>{floorNo}층 돌파! 보상을 골라요</h2>
      <ChoiceList
        kind="card"
        items={draft.map((u) => {
          // 조합 재료 카드엔 '합본까지 N장' 힌트 — 진화 시스템이 첫 드래프트부터 보인다
          const hint = evoHintFor(u, build);
          return {
            key: u.id,
            className: `rarity-${u.rarity}${u.evo ? ' evo' : ''}`,
            label: (
              <>
                <span className="card-icon">{u.icon}</span>
                <span className="card-name">{u.name}</span>
                <span className="card-desc">{u.desc}</span>
                {hint && (
                  <span className={`evo-hint${hint.remain === 0 ? ' ready' : ''}`}>
                    {hint.remain === 0
                      ? `${hint.evo.icon} 집으면 합본 「${hint.evo.name}」 완성!`
                      : `${hint.evo.icon} 합본 「${hint.evo.name}」까지 ${hint.remain}장`}
                  </span>
                )}
                {/* 진화 카드는 '합본' 표기 — 조합 달성의 잿팟임을 보여준다 */}
                <span className="card-tag">{u.evo ? '📖 합본' : u.tag}</span>
              </>
            ),
            onPick: () => onPick(u),
          };
        })}
      />
    </div>
  );
}
