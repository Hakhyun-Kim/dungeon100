import { ChoiceList } from './Menu';

// 층 진행 선택 화면들 — 포털(다음 층)과 5층 단위 마을 문.

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
