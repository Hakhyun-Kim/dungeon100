import { MAX_DOOR_ROUND, type DungeonMode } from '../lib/quiz';
import type { Upgrade } from '../lib/upgrades';
import { ChoiceList, PrimaryButton } from './Menu';

// 보물상자 미니게임 결과 화면들 — 두 문 달리기/아레나 공용 보상 화면 + 아레나 재도전.

export type QuizView = 'ok' | 'no' | 'choice';

// 미니게임 결과: choice = 푸시-유어-럭(더 달릴까), ok = 보상 획득, no = 빈손
export function QuizResultScreen({
  view,
  mode,
  doorRound,
  rewards,
  answerText,
  onTakeReward,
  onRunDeeper,
  onContinue,
}: {
  view: QuizView;
  mode: DungeonMode;
  doorRound: number;
  rewards: Upgrade[];
  answerText: string;
  onTakeReward: () => void;
  onRunDeeper: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="screen quiz-screen">
      {view === 'choice' && (
        <>
          <h2>🚪 {doorRound}번째 문 통과!</h2>
          <p className="quiz-sub">더 깊이 달릴수록 보물이 좋아진다… 하지만 틀리면 전부 빈손!</p>
          <ChoiceList
            items={[
              {
                key: 'take',
                label: `🎁 여기서 보상 받기 — 아이템 ${doorRound}개`,
                onPick: onTakeReward,
              },
              {
                key: 'deeper',
                label:
                  doorRound + 1 >= MAX_DOOR_ROUND
                    ? '🔥 마지막 문에 도전! (전설의 보물)'
                    : '🔥 더 달린다!',
                onPick: onRunDeeper,
              },
            ]}
          />
        </>
      )}
      {view === 'ok' && rewards.length > 0 && (
        <>
          <h2>
            {rewards.length >= MAX_DOOR_ROUND
              ? mode === 'monster'
                ? '🏆 세 보석의 축복!'
                : '🏆 전설의 보물이다!'
              : '🎉 보물을 얻었다!'}
          </h2>
          {rewards.length >= MAX_DOOR_ROUND && (
            <p className="quiz-sub">
              {mode === 'monster'
                ? '세 개의 보석을 모두 손에 넣었다! 체력도 가득 찼다.'
                : '세 개의 문을 모두 통과! 체력도 가득 찼다.'}
            </p>
          )}
          <div className="cards">
            {rewards.map((u, i) => (
              <div key={`${u.id}${i}`} className="card reward-pop">
                <span className="card-icon">{u.icon}</span>
                <span className="card-name">{u.name}</span>
                <span className="card-desc">{u.desc}</span>
              </div>
            ))}
          </div>
          <PrimaryButton onPick={onContinue}>계속 탐험</PrimaryButton>
        </>
      )}
      {view === 'no' && (
        <>
          {mode === 'monster' ? (
            <>
              <h2>💨 보석을 하나도 줍지 못했다…</h2>
              <p className="quiz-sub">
                무리에 밀려 빈손으로 물러났다. 상자가 먼지가 되어 사라졌다…
              </p>
            </>
          ) : (
            <>
              <h2>💨 아쉽다! 정답은 {answerText}</h2>
              <p className="quiz-sub">
                {doorRound > 1
                  ? `${doorRound - 1}개의 문을 통과했지만… 보물은 전부 먼지가 되었다.`
                  : '상자가 먼지가 되어 사라졌다…'}
              </p>
            </>
          )}
          <PrimaryButton onPick={onContinue}>계속 탐험</PrimaryButton>
        </>
      )}
    </div>
  );
}

// 아레나에서 쓰러짐 — 본체는 무사, 재도전 or 모은 보석만큼 받고 나가기
export function ArenaOverScreen({
  gems,
  onRetry,
  onBail,
}: {
  gems: number;
  onRetry: () => void;
  onBail: () => void;
}) {
  return (
    <div className="screen quiz-screen">
      <h2>💥 아레나에서 쓰러졌다</h2>
      <p className="quiz-sub">
        하지만 본체는 무사하다 — 이 상자는 몇 번이고 다시 도전할 수 있다.
        {gems > 0 && (
          <>
            <br />
            지금까지 💎 {gems}개를 모았다.
          </>
        )}
      </p>
      <ChoiceList
        items={[
          { key: 'retry', label: '🔁 다시 도전 (보석 초기화)', onPick: onRetry },
          {
            key: 'bail',
            label: gems > 0 ? `🎁 여기까지 — 보석 ${gems}개 받기` : '🏳️ 포기하고 나간다',
            onPick: onBail,
          },
        ]}
      />
    </div>
  );
}
