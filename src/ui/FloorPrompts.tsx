import type { Upgrade } from '../lib/upgrades';
import { ChoiceList, PrimaryButton } from './Menu';

// 층 진행·방 이벤트 선택 화면들 — 포털·마을 문·제단·찢어진 페이지(비밀 문).

export function PortalScreen({
  floorNo,
  onDescend,
  onStay,
}: {
  floorNo: number;
  onDescend: () => void;
  onStay: () => void;
}) {
  return (
    <div className="screen quiz-screen">
      <h2>🌀 아래로 내려가는 포털이 열려 있다</h2>
      <p className="quiz-sub">다음 층은 더 위험하다. {floorNo + 1}층으로 내려가시겠습니까?</p>
      <ChoiceList
        items={[
          { key: 'down', label: '⬇️ 내려간다', onPick: onDescend },
          { key: 'stay', label: '🕐 아직 이 층을 더 둘러볼래', onPick: onStay },
        ]}
      />
    </div>
  );
}

export function HomeDoorScreen({ onOpen, onSkip }: { onOpen: () => void; onSkip: () => void }) {
  return (
    <div className="screen quiz-screen">
      <h2>🔔 어디선가 은은한 종소리…</h2>
      <p className="quiz-sub">
        따뜻한 빛이 새어 나오는 나무 문이다. 마을로 이어지는 것 같다.
        <br />
        (5층마다 나타난다는 그 문인가? 왜 있는지는 아무도 모른다.)
      </p>
      <ChoiceList
        items={[
          { key: 'open', label: '🚪 문을 연다 — 마을에 들른다', onPick: onOpen },
          { key: 'skip', label: '🕯️ 지금은 던전에 집중한다', onPick: onSkip },
        ]}
      />
    </div>
  );
}

// 낡은 제단 — 체력을 바치면 보물 하나. 바치면 소멸, 거절하면 벗어났다 다시 올 수 있다.
export function AltarScreen({
  hp,
  cost,
  reward,
  onOffer,
  onDecline,
  onContinue,
}: {
  hp: number;
  cost: number;
  reward: Upgrade | null;
  onOffer: () => void;
  onDecline: () => void;
  onContinue: () => void;
}) {
  if (reward) {
    return (
      <div className="screen quiz-screen">
        <h2>🩸 제단이 응답했다</h2>
        <p className="quiz-sub">바친 피가 잉크가 되어, 새 힘이 쓰였다.</p>
        <div className="cards">
          <div className={`card reward-pop rarity-${reward.rarity}`}>
            <span className="card-icon">{reward.icon}</span>
            <span className="card-name">{reward.name}</span>
            <span className="card-desc">{reward.desc}</span>
            <span className="card-tag">{reward.tag}</span>
          </div>
        </div>
        <PrimaryButton onPick={onContinue}>계속 탐험</PrimaryButton>
      </div>
    );
  }
  const tooWeak = hp <= cost; // 바치면 죽는 체력으로는 제단이 받지 않는다
  return (
    <div className="screen quiz-screen">
      <h2>🕯️ 낡은 제단이 있다</h2>
      <p className="quiz-sub">
        돌에 새겨진 글씨 — 「피를 잉크로. 이야기는 대가를 원한다.」
        <br />
        체력 {cost}을 바치면 보물을 하나 얻을 것 같다.
      </p>
      <ChoiceList
        items={[
          {
            key: 'offer',
            label: tooWeak ? `🩸 체력 ${cost} 바치기 (체력이 부족하다)` : `🩸 체력 ${cost}을 바친다`,
            disabled: tooWeak,
            onPick: onOffer,
          },
          { key: 'skip', label: '🙅 지금은 그만둔다', onPick: onDecline },
        ]}
      />
    </div>
  );
}

// 찢어진 페이지 — 방·층을 건너뛰는 비밀 문. 성장 기회를 버리는 대신 깊이를 번다.
export function SecretDoorScreen({
  floorNo,
  onJump,
  onDecline,
}: {
  floorNo: number;
  onJump: () => void;
  onDecline: () => void;
}) {
  const target = Math.min(100, floorNo + 2);
  return (
    <div className="screen quiz-screen">
      <h2>📄 찢어진 페이지</h2>
      <p className="quiz-sub">
        허공에 종잇조각이 팔랑인다. 틈 사이로 {target}층의 어둠이 내려다보인다.
        <br />몇 장을 그냥 넘겨 버릴 수 있을 것 같다 — 대신 건너뛴 층의 보물과 보상도 없다.
      </p>
      <ChoiceList
        items={[
          {
            key: 'jump',
            label: `📄 페이지를 넘겨 버린다 — ${target}층으로 (착지 충격)`,
            onPick: onJump,
          },
          { key: 'skip', label: '🕯️ 지금은 그만둔다', onPick: onDecline },
        ]}
      />
    </div>
  );
}
