import { ChoiceList } from './Menu';

// 게임오버 — 죽음 로어 + 부활 선택 (체크포인트 마을 or 처음부터)
export default function OverScreen({
  floorNo,
  kills,
  best,
  coins,
  lore,
  checkpointFloor,
  daily = false,
  onResume,
  onRetry,
  onVillage,
  onShare,
}: {
  floorNo: number;
  kills: number;
  best: number;
  coins: number;
  lore: string;
  checkpointFloor: number;
  daily?: boolean;
  onResume: () => void;
  onRetry: () => void;
  onVillage: () => void;
  onShare: () => void;
}) {
  return (
    <div className="screen over-screen">
      <h2>💀 {floorNo}층에서 쓰러졌다…</h2>
      <p>
        처치 {kills} · 최고 기록 {Math.max(best, floorNo)}층
      </p>
      {daily && <p className="best">📅 오늘의 던전 기록으로 저장! 기록 카드로 인증해 보세요</p>}
      <p className="over-lore">{lore}</p>
      <p className="quiz-sub">🪙 {coins} — 코인은 사라지지 않았다. 이야기도, 이어진다.</p>
      <ChoiceList
        items={[
          checkpointFloor >= 5
            ? {
                key: 'resume',
                label: `🏘️ ${checkpointFloor}층 마을에서 다시 (장비 유지)`,
                onPick: onResume,
              }
            : { key: 'retry', label: '⚔️ 바로 다시 도전', onPick: onRetry },
          { key: 'village', label: '🏘️ 처음부터 (마을·대장간 🛠️)', onPick: onVillage },
        ]}
      />
      <button className="skip-btn" onClick={onShare}>
        📸 기록 카드 저장
      </button>
    </div>
  );
}
