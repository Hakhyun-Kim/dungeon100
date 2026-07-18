import { MEMORIES } from '../lib/story';
import { ChoiceList, PrimaryButton } from './Menu';

// 타이틀 화면 — 시연 모드(?demo)에서는 시연 버튼이 추가돼 세로 메뉴가 된다.
export default function TitleScreen({
  best,
  memCount,
  storySeen,
  demoMode,
  muted,
  onToggleMute,
  onStart,
  onReplay,
  onDemo,
}: {
  best: number;
  memCount: number;
  storySeen: boolean;
  demoMode: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onStart: () => void;
  onReplay: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="screen title-screen">
      <button className="hud-chip mute-btn title-mute" onClick={onToggleMute}>
        {muted ? '🔇' : '🔊'}
      </button>
      <h1>백층 던전</h1>
      <p className="tagline">책 속으로 떨어진 대학생의 귀환 대작전 — 100층까지 내려가라!</p>
      <div className="howto">
        <p>🕹️ 이동: 화면 드래그 (PC는 WASD/방향키)</p>
        <p>⚔️ 공격: 가까운 적을 자동으로 조준</p>
        <p>🗝️ 보물상자 = 두 문 달리기! 깊이 달릴수록 좋은 보물</p>
        <p>🌀 포털로 다음 층 — 내려갈지는 당신의 선택</p>
      </div>
      {best > 0 && (
        <p className="best">
          최고 기록: {best}층 · 되찾은 기억 {Math.min(memCount, MEMORIES.length)}개
        </p>
      )}
      {demoMode ? (
        <ChoiceList
          kind="big"
          items={[
            {
              key: 'demo',
              label: '🎬 자동 시연 보기 (약 100초)',
              className: 'demo-start',
              onPick: onDemo,
            },
            { key: 'start', label: '모험 시작', onPick: onStart },
          ]}
        />
      ) : (
        <PrimaryButton onPick={onStart}>모험 시작</PrimaryButton>
      )}
      {storySeen && (
        <button className="skip-btn" onClick={onReplay}>
          📖 스토리 다시 보기
        </button>
      )}
    </div>
  );
}
