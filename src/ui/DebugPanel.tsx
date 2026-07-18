import { useState } from 'react';
import { useMenuStack } from './Menu';

// 디버그 층 이동 (Shift+D — DEV 또는 ?debug). 단축키 처리(Shift+D/P/M·Esc)는 App 담당.
// useMenuStack만 등록해 아래에 깔린 메뉴(포털·게임오버 등)가 키를 받지 않게 한다.
export default function DebugPanel({
  onJump,
  onClose,
}: {
  onJump: (floor: number) => void;
  onClose: () => void;
}) {
  useMenuStack();
  const [floor, setFloor] = useState('');
  return (
    <div className="screen debug-screen">
      <h2>🛠️ 디버그 — 층 이동</h2>
      <div className="debug-grid">
        {[1, 5, 10, 20, 30, 50, 56, 70, 90, 100].map((n) => (
          <button key={n} className="choice-btn debug-jump" onClick={() => onJump(n)}>
            {n}층
          </button>
        ))}
      </div>
      <div className="debug-row">
        <input
          className="debug-input"
          type="number"
          min={1}
          max={100}
          placeholder="층 번호"
          value={floor}
          onChange={(e) => setFloor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && floor) onJump(Number(floor));
          }}
        />
        <button className="choice-btn" onClick={() => floor && onJump(Number(floor))}>
          이동
        </button>
      </div>
      <p className="quiz-sub">
        Shift+D 열기/닫기 · Esc 닫기 · 이동하면 체력 회복 · Shift+P 보물(아이템 3개+회복) ·
        Shift+M 코인 +100
      </p>
      <button className="skip-btn" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}
