import type { DailyRecord } from '../lib/daily';
import { MEMORIES } from '../lib/story';
import { ChoiceList } from './Menu';

// 타이틀 화면 — 모험 시작·일일 던전 세로 메뉴 (?demo에서는 시연 버튼 추가).
export default function TitleScreen({
  best,
  memCount,
  storySeen,
  demoMode,
  muted,
  dailyRecord,
  onToggleMute,
  onStart,
  onDaily,
  onReplay,
  onDemo,
}: {
  best: number;
  memCount: number;
  storySeen: boolean;
  demoMode: boolean;
  muted: boolean;
  dailyRecord: DailyRecord | null; // 오늘 날짜의 기록 (없으면 null)
  onToggleMute: () => void;
  onStart: () => void;
  onDaily: () => void;
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
      {dailyRecord && (
        <p className="best">
          📅 오늘의 던전 기록: {dailyRecord.cleared ? '100층 완주!' : `${dailyRecord.floor}층`}
        </p>
      )}
      <ChoiceList
        kind="big"
        items={[
          ...(demoMode
            ? [
                {
                  key: 'demo',
                  label: '🎬 자동 시연 보기 (약 100초)',
                  className: 'demo-start',
                  onPick: onDemo,
                },
              ]
            : []),
          { key: 'start', label: '모험 시작', onPick: onStart },
          {
            key: 'daily',
            label: '📅 오늘의 던전',
            className: 'daily-btn',
            onPick: onDaily,
          },
        ]}
      />
      <p className="quiz-sub daily-hint">
        오늘의 던전: 날짜가 시드 — 모두가 같은 맵에 도전 (어른 문제 고정, 기록 카드로 인증)
      </p>
      {storySeen && (
        <button className="skip-btn" onClick={onReplay}>
          📖 스토리 다시 보기
        </button>
      )}
    </div>
  );
}
