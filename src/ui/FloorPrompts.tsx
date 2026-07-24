import type { Upgrade } from '../lib/upgrades';
import { ChoiceList, PrimaryButton } from './Menu';

// 층 진행·방 이벤트 선택 화면들 — 포털·마을 문·제단·찢어진 페이지(비밀 문).

export function PortalScreen({
  floorNo,
  danger = false,
  onDescend,
  onDanger,
  onStay,
}: {
  floorNo: number;
  danger?: boolean; // 갈림길 — 「모험의 길」 선택지가 열려 있는가 (층 시드 35%)
  onDescend: () => void;
  onDanger?: () => void;
  onStay: () => void;
}) {
  return (
    <div className="screen quiz-screen">
      <h2>🌀 아래로 내려가는 포털이 열려 있다</h2>
      <p className="quiz-sub">
        다음 층은 더 위험하다. {floorNo + 1}층으로 내려가시겠습니까?
        {danger && (
          <>
            <br />
            …포털 너머, 평소보다 붉게 일렁이는 갈림길이 보인다.
          </>
        )}
      </p>
      <ChoiceList
        items={[
          { key: 'down', label: '⬇️ 내려간다', onPick: onDescend },
          ...(danger && onDanger
            ? [
                {
                  key: 'danger',
                  label: '🔥 모험의 길 — 사나운 층, 대신 돌파 보상은 전부 레어 이상',
                  onPick: onDanger,
                },
              ]
            : []),
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

// 두 갈래 틈 — 층 안에서 멀리 떨어진 곳으로 이어지는 순간이동 지름길 (한 쌍, 왕복 가능)
export function RiftScreen({ onEnter, onDecline }: { onEnter: () => void; onDecline: () => void }) {
  return (
    <div className="screen quiz-screen">
      <h2>🌫️ 두 갈래 틈</h2>
      <p className="quiz-sub">
        공중에 종이가 겹쳐 접힌 듯한 틈이 일렁인다.
        <br />
        틈 저편에서 바람이 분다 — 이 층의 다른 어딘가와 이어져 있는 모양이다.
      </p>
      <ChoiceList
        items={[
          { key: 'enter', label: '🌀 틈으로 들어간다', onPick: onEnter },
          { key: 'skip', label: '🕯️ 지금은 그만둔다', onPick: onDecline },
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
