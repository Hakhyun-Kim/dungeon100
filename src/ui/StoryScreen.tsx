import { STORY_NODES } from '../lib/story';
import { sfx } from '../lib/sound';
import { ChoiceList, PrimaryButton } from './Menu';

// 인터랙티브 인트로 — 슬라이드 + 책이 문제를 내는 퀴즈 노드(정답/오답 모두 빨려 들어가는 개그).
// 배경 클릭 진행은 퀴즈 미답변 중 잠금.
export default function StoryScreen({
  idx,
  answer,
  onAnswer,
  onAdvance,
  onSkip,
}: {
  idx: number;
  answer: 'ok' | 'no' | null;
  onAnswer: (a: 'ok' | 'no') => void;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const node = STORY_NODES[idx];
  const isLast = idx >= STORY_NODES.length - 1;
  const quizPending = node.kind === 'quiz' && answer === null;
  return (
    <div className="screen story-screen" onClick={() => !quizPending && onAdvance()}>
      <div className="story-icon">{node.icon}</div>
      {node.kind === 'slide' && <p className="story-text">{node.text}</p>}
      {node.kind === 'quiz' && answer === null && (
        <>
          <p className="story-text">{node.intro}</p>
          <h2 className="story-quiz-q">{node.q}</h2>
          <ChoiceList
            containerClass="dialog-choices story-quiz-choices"
            items={node.answers.map((a, i) => ({
              key: a,
              label: `🚪 ${a}`,
              onPick: () => {
                if (i === node.correct) {
                  sfx.pass();
                  onAnswer('ok');
                } else {
                  sfx.crash();
                  onAnswer('no');
                }
              },
            }))}
          />
        </>
      )}
      {node.kind === 'quiz' && answer !== null && (
        <p className="story-text">{answer === 'ok' ? node.okText : node.noText}</p>
      )}
      <div className="story-btns">
        {!quizPending && (
          <PrimaryButton onPick={onAdvance}>{isLast ? '마을로 가 본다' : '다음 ▶'}</PrimaryButton>
        )}
        <button
          className="skip-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
        >
          건너뛰기 ⏭
        </button>
      </div>
      <p className="story-page">
        {idx + 1} / {STORY_NODES.length}
      </p>
    </div>
  );
}
