import type { Upgrade } from '../lib/upgrades';
import { ChoiceList } from './Menu';

// 층 돌파 보상 드래프트 — 3장 중 1장 선택
export default function DraftScreen({
  floorNo,
  draft,
  onPick,
}: {
  floorNo: number;
  draft: Upgrade[];
  onPick: (u: Upgrade) => void;
}) {
  return (
    <div className="screen draft-screen">
      <h2>{floorNo}층 돌파! 보상을 골라요</h2>
      <ChoiceList
        kind="card"
        items={draft.map((u) => ({
          key: u.id,
          className: `rarity-${u.rarity}`,
          label: (
            <>
              <span className="card-icon">{u.icon}</span>
              <span className="card-name">{u.name}</span>
              <span className="card-desc">{u.desc}</span>
              <span className="card-tag">{u.tag}</span>
            </>
          ),
          onPick: () => onPick(u),
        }))}
      />
    </div>
  );
}
