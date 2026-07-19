import {
  MEMORY_SETS,
  setProgress,
  type Memory,
  type MemorySetId,
} from '../lib/memories';
import { getLore, TRACES } from '../lib/story';
import type { Upgrade } from '../lib/upgrades';
import { PrimaryButton } from './Menu';

// 이야기 오버레이들 — 벽의 글귀·소녀의 흔적·되찾은 기억·갈래 완성(능력 각성)·기억 완성.

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

// 네 갈래의 진행도 — 어떤 기억을 얼마나 모았는지 한눈에 (기억 화면·타이틀 공용)
export function SetProgressRow({ collected }: { collected: string[] }) {
  return (
    <div className="set-row">
      {setProgress(collected).map((p) => (
        <span key={p.set.id} className={`set-chip${p.done ? ' done' : ''}`}>
          {p.set.icon} {p.set.name}
          <em>
            {p.have}/{p.total}
          </em>
          {p.done && <b>{p.set.power.icon}</b>}
        </span>
      ))}
    </div>
  );
}

// 보물 획득 후 되찾은 기억 1개 — 어느 갈래의 조각인지 함께 보여 준다
export function MemoryScreen({
  memory,
  collected,
  max,
  onClose,
}: {
  memory: Memory;
  collected: string[]; // 이 기억을 포함한 회수 목록
  max: number;
  onClose: () => void;
}) {
  const set = MEMORY_SETS[memory.set];
  const prog = setProgress(collected).find((p) => p.set.id === memory.set)!;
  const left = prog.total - prog.have;
  return (
    <div className="screen memory-screen">
      <p className="memory-label">보물의 빛이 스며들자, 잊고 있던 기억이 하나 돌아왔다</p>
      <div className="memory-icon">{memory.icon}</div>
      <p className="memory-set">
        {set.icon} {set.name} · {prog.have} / {prog.total}
      </p>
      <h2 className="memory-title">{memory.title}</h2>
      <p className="memory-text">{memory.text}</p>
      <p className="memory-count">
        {left > 0 ? (
          <>
            이 갈래를 {left}조각 더 모으면 — <b>{set.power.name}</b>
          </>
        ) : (
          <>되찾은 기억 {collected.length} / {max}</>
        )}
      </p>
      <PrimaryButton onPick={onClose}>가슴에 담는다</PrimaryButton>
    </div>
  );
}

// 갈래 완성 — 특별한 능력이 깨어난다 (판을 넘어 남는 메타 성장)
export function MemorySetScreen({
  setId,
  collected,
  onContinue,
}: {
  setId: MemorySetId;
  collected: string[];
  onContinue: () => void;
}) {
  const set = MEMORY_SETS[setId];
  return (
    <div className="screen memory-screen memset-screen">
      <p className="memory-label">흩어져 있던 조각들이 하나로 이어진다</p>
      <div className="memory-icon">{set.icon}</div>
      <h2 className="memory-title">
        「{set.name}」 완성!
      </h2>
      <p className="memory-text">{set.desc}</p>
      <div className="power-card">
        <span className="power-icon">{set.power.icon}</span>
        <span className="power-name">{set.power.name}</span>
        <span className="power-desc">{set.power.desc}</span>
      </div>
      <SetProgressRow collected={collected} />
      <p className="memory-count">이 힘은 다음 판에도 남는다</p>
      <PrimaryButton onPick={onContinue}>가슴이 뜨거워진다</PrimaryButton>
    </div>
  );
}

// 마지막 기억 회수 — 완성 보상 (아이템 2개 + 완전 회복 + 시작 체력 영구 +30)
export function MemFullScreen({
  rewards,
  total,
  onContinue,
}: {
  rewards: Upgrade[];
  total: number;
  onContinue: () => void;
}) {
  return (
    <div className="screen memory-screen">
      <div className="memory-icon">💫</div>
      <h2 className="memory-title">모든 기억을 되찾았다!</h2>
      <p className="memory-text">
        {total}개의 기억이 가슴 속에서 빛난다.{'\n'}이제 이 던전이 앗아갈 수 있는 것은, 아무것도
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
      <p className="memory-count">체력도 가득 찼다 · 앞으로 시작 최대 체력 +30</p>
      <PrimaryButton onPick={onContinue}>힘이 차오른다!</PrimaryButton>
    </div>
  );
}
