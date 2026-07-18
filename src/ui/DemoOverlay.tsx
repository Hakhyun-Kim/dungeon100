import { ChoiceList } from './Menu';

// 자동 시연 모드(?demo) 오버레이 — 자막·종료 버튼·끝 화면.
// 시연 종료/직접 플레이는 쿼리 없는 주소로 리로드 (세이브 오염 없이 초기화).

export function DemoCaption({ text }: { text: string }) {
  return <div className="demo-caption">{text}</div>;
}

export function DemoExitButton() {
  return (
    <button className="demo-exit" onClick={() => (location.href = location.pathname)}>
      ✕ 시연 종료
    </button>
  );
}

export function DemoEndScreen({ onReplay }: { onReplay: () => void }) {
  return (
    <div className="screen demo-end">
      <h2>🎬 시연 끝!</h2>
      <p className="quiz-sub">
        방금 본 것은 절반도 안 됩니다 — 56층의 소녀 '여백', 층층이 숨은 흔적과 벽의 글귀,
        <br />
        100층의 황금 문과 두 가지 엔딩, 그리고 10년 후의 에필로그….
      </p>
      <ChoiceList
        items={[
          { key: 'replay', label: '🔁 다시 보기', onPick: onReplay },
          {
            key: 'play',
            label: '🎮 직접 플레이하러 가기',
            onPick: () => (location.href = location.pathname),
          },
        ]}
      />
    </div>
  );
}
