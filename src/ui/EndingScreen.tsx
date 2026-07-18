import {
  ENDING_ALONE,
  ENDING_TOGETHER,
  ENDING_GIRL_EXTRA,
  ENDING_NAME_PRINCESS,
  ENDING_EPILOGUE,
  MEMORIES,
} from '../lib/story';
import { ChoiceList, PrimaryButton } from './Menu';

export type EndingVariant = 'alone' | 'together' | null;

// 엔딩 (100층 황금 문) — 혼자/함께 선택 → 에필로그 슬라이드 → 통계 화면.
// 여백을 만났으면(girlMet) 추가 장면, 함께 엔딩엔 '공주의 이름' 장면.
export default function EndingScreen({
  variant,
  idx,
  girlMet,
  kills,
  memCount,
  onPickVariant,
  onNext,
  onTitle,
  onShare,
}: {
  variant: EndingVariant;
  idx: number;
  girlMet: boolean;
  kills: number;
  memCount: number;
  onPickVariant: (v: 'alone' | 'together') => void;
  onNext: () => void;
  onTitle: () => void;
  onShare: () => void;
}) {
  if (variant === null) {
    return (
      <div className="screen ending-screen">
        <div className="story-icon">🚪</div>
        <h2>황금빛 문이 열려 있다</h2>
        <p className="story-text">
          100층 — 페이지의 수호자는 쓰러졌고,{'\n'}이 문을 넘으면, 집이다.
        </p>
        <ChoiceList
          containerClass="dialog-choices story-quiz-choices"
          items={[
            { key: 'alone', label: '🚶 혼자 문을 연다', onPick: () => onPickVariant('alone') },
            {
              key: 'together',
              label: '👵 촌장을 데리러 간다',
              onPick: () => onPickVariant('together'),
            },
          ]}
        />
      </div>
    );
  }
  const baseSlides = variant === 'alone' ? ENDING_ALONE : ENDING_TOGETHER;
  // 여백을 만났으면: 함께 엔딩엔 '공주의 이름' 장면, 모든 엔딩에 손 흔드는 장면.
  // 그 뒤로 10년 후 에필로그(2탄 예고)는 공통.
  const slides = [
    ...baseSlides,
    ...(girlMet && variant === 'together' ? [ENDING_NAME_PRINCESS] : []),
    ...(girlMet ? [ENDING_GIRL_EXTRA] : []),
    ...ENDING_EPILOGUE,
  ];
  if (idx < slides.length) {
    const s = slides[idx];
    return (
      <div className="screen ending-screen" onClick={onNext}>
        <div className="story-icon">{s.icon}</div>
        <p className="story-text">{s.text}</p>
        <PrimaryButton onPick={onNext}>다음 ▶</PrimaryButton>
      </div>
    );
  }
  return (
    <div className="screen ending-screen">
      <h1 className="ending-title">— 끝 —</h1>
      <p className="story-text">
        🏰 100층 완주 · 💀 처치 {kills} · 💭 되찾은 기억 {Math.min(memCount, MEMORIES.length)} /{' '}
        {MEMORIES.length}
      </p>
      <p className="quiz-sub">당신이 이 책의 마지막 장을 썼다.</p>
      <PrimaryButton onPick={onTitle}>처음부터</PrimaryButton>
      <button className="skip-btn" onClick={onShare}>
        📸 완주 카드 저장
      </button>
    </div>
  );
}
