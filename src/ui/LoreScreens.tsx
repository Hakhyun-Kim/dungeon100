import { getLore, TRACES, type Memory } from '../lib/story';
import type { Upgrade } from '../lib/upgrades';
import { PrimaryButton } from './Menu';

// 이야기 오버레이들 — 벽의 글귀·소녀의 흔적·되찾은 기억·기억 완성.

// 새 층 도착 시 벽의 글귀 1개
export function LoreScreen({ floorNo, onContinue }: { floorNo: number; onContinue: () => void }) {
  return (
    <div className="screen lore-screen">
      <p className="lore-label">🕯️ {floorNo}층 — 벽에 긁어 쓴 글씨가 보인다</p>
      <p className="lore-text">{getLore(floorNo)}</p>
      <PrimaryButton onPick={onContinue}>계속 내려간다</PrimaryButton>
    </div>
  );
}

// 소녀의 흔적 (14·28·42·49층 복선 오브젝트)
export function TraceScreen({ floorNo, onContinue }: { floorNo: number; onContinue: () => void }) {
  const trace = TRACES[floorNo];
  if (!trace) return null;
  return (
    <div className="screen lore-screen">
      <div className="story-icon">{trace.icon}</div>
      <p className="lore-label">{floorNo}층 — 누군가의 흔적</p>
      <p className="lore-text">{trace.text}</p>
      <PrimaryButton onPick={onContinue}>…계속 가 보자</PrimaryButton>
    </div>
  );
}

// 보물 획득 후 되찾은 기억 1개
export function MemoryScreen({
  memory,
  count,
  max,
  onClose,
}: {
  memory: Memory;
  count: number;
  max: number;
  onClose: () => void;
}) {
  return (
    <div className="screen memory-screen">
      <p className="memory-label">보물의 빛이 스며들자, 잊고 있던 기억이 하나 돌아왔다</p>
      <div className="memory-icon">{memory.icon}</div>
      <h2 className="memory-title">{memory.title}</h2>
      <p className="memory-text">{memory.text}</p>
      <p className="memory-count">
        되찾은 기억 {count} / {max}
      </p>
      <PrimaryButton onPick={onClose}>가슴에 담는다</PrimaryButton>
    </div>
  );
}

// 12번째 기억 회수 — 완성 보상 (아이템 2개 + 완전 회복)
export function MemFullScreen({
  rewards,
  onContinue,
}: {
  rewards: Upgrade[];
  onContinue: () => void;
}) {
  return (
    <div className="screen memory-screen">
      <div className="memory-icon">💫</div>
      <h2 className="memory-title">모든 기억을 되찾았다!</h2>
      <p className="memory-text">
        열두 개의 기억이 가슴 속에서 빛난다.{'\n'}이제 이 던전이 앗아갈 수 있는 것은, 아무것도
        없다.
      </p>
      <div className="cards">
        {rewards.map((u, i) => (
          <div key={`${u.id}${i}`} className={`card reward-pop rarity-${u.rarity}`}>
            <span className="card-icon">{u.icon}</span>
            <span className="card-name">{u.name}</span>
            <span className="card-desc">{u.desc}</span>
            <span className="card-tag">{u.tag}</span>
          </div>
        ))}
      </div>
      <p className="memory-count">체력도 가득 찼다</p>
      <PrimaryButton onPick={onContinue}>힘이 차오른다!</PrimaryButton>
    </div>
  );
}
