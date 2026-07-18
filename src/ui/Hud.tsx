import { UPGRADES } from '../lib/upgrades';
import type { DungeonMode } from '../lib/quiz';

// 캔버스 위 상시 표시 UI — HUD 칩·체력바·빌드 칩·보스 체력바.
// HUD는 z-index 50으로 오버레이(30) 위 — 음소거 버튼이 팝업 중에도 항상 눌린다.

function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button className="hud-chip mute-btn" onClick={onToggle}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

// 던전 본편 HUD — 모드·층 칩 + 체력바 + 처치·코인 (일일 던전은 📅 표시)
export function GameHud({
  mode,
  daily = false,
  floorNo,
  hp,
  maxHp,
  kills,
  coins,
  muted,
  onToggleMute,
}: {
  mode: DungeonMode;
  daily?: boolean;
  floorNo: number;
  hp: number;
  maxHp: number;
  kills: number;
  coins: number;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  return (
    <div className="hud">
      <div className="hud-chip">
        {daily ? '📅' : mode === 'kids' ? '🎒' : mode === 'adult' ? '🧠' : '👹'} {floorNo}층
      </div>
      <div className="hp-wrap">
        <div className="hp-bar" style={{ width: `${ratio * 100}%` }} />
        <span className="hp-text">
          {Math.ceil(hp)} / {Math.round(maxHp)}
        </span>
      </div>
      <div className="hud-chip">💀 {kills}</div>
      <div className="hud-chip">🪙 {coins}</div>
      <MuteButton muted={muted} onToggle={onToggleMute} />
    </div>
  );
}

// 몬스터 아레나 HUD — 아레나 전용 체력 + 보석 진행도
export function ArenaHud({
  hp,
  max,
  gems,
  muted,
  onToggleMute,
}: {
  hp: number;
  max: number;
  gems: number;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div className="hud">
      <div className="hud-chip">👹 아레나</div>
      <div className="hp-wrap">
        <div className="hp-bar" style={{ width: `${Math.max(0, (hp / max) * 100)}%` }} />
        <span className="hp-text">
          {Math.ceil(hp)} / {max}
        </span>
      </div>
      <div className="hud-chip">💎 {gems} / 3</div>
      <MuteButton muted={muted} onToggle={onToggleMute} />
    </div>
  );
}

// 걸어다니는 마을 HUD — 시절 이름 칩
export function VillageHud({
  stageName,
  muted,
  onToggleMute,
}: {
  stageName: string;
  muted: boolean;
  onToggleMute: () => void;
}) {
  return (
    <div className="hud">
      <div className="hud-chip">{stageName}</div>
      <div className="hud-spacer" />
      <MuteButton muted={muted} onToggle={onToggleMute} />
    </div>
  );
}

// 현재 빌드 (획득한 아이템 아이콘 × 개수)
export function BuildRow({ build }: { build: Record<string, number> }) {
  return (
    <div className="build-row">
      {UPGRADES.filter((u) => build[u.id]).map((u) => (
        <span key={u.id} className="build-chip">
          {u.icon}
          {build[u.id] > 1 && <em>×{build[u.id]}</em>}
        </span>
      ))}
    </div>
  );
}

// 보스 "페이지의 수호자" 체력바
export function BossBar({ hp, max }: { hp: number; max: number }) {
  return (
    <div className="boss-bar-wrap">
      <span className="boss-label">📖 페이지의 수호자</span>
      <div className="boss-bar-outer">
        <div className="boss-bar" style={{ width: `${(hp / max) * 100}%` }} />
      </div>
    </div>
  );
}
