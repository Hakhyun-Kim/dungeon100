import { useEffect, useRef } from 'react';
import type { TownNode, TownOption } from '../lib/story';
import { ChoiceList } from './Menu';

// 별도 DOM 마을 화면 ('town' phase — 현재 56층 소녀 찻자리 전용).
// 대사(line)는 클릭 또는 Enter/Space/→ 진행, 선택지는 ChoiceList 표준 메뉴.
export default function TownDialogScreen({
  node,
  floorNo,
  townMode,
  scape,
  giftName,
  keysLocked,
  onAdvance,
  onChoose,
}: {
  node: TownNode;
  floorNo: number;
  townMode: 'pre' | 'visit' | 'girl';
  scape: { sky: string; scape: string };
  giftName: string | null;
  keysLocked: boolean;
  onAdvance: (next: number) => void;
  onChoose: (o: TownOption) => void;
}) {
  const stateRef = useRef({ node, keysLocked, onAdvance });
  stateRef.current = { node, keysLocked, onAdvance };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (s.keysLocked || e.repeat) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (s.node.kind !== 'line') return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault();
        s.onAdvance(s.node.next);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="screen town-screen">
      <div className="town-sky">{scape.sky}</div>
      <div className="town-scape">{scape.scape}</div>
      {townMode === 'visit' && <div className="town-floor-chip">🔔 {floorNo}층의 문 → 마을</div>}
      {townMode === 'girl' && (
        <div className="town-floor-chip">🍵 {floorNo}층 — 페이지 사이의 찻자리</div>
      )}
      {node.kind === 'line' ? (
        <div className="dialog-box" onClick={() => onAdvance(node.next)}>
          <div className="dialog-speaker">
            <span className="dialog-icon">{node.icon}</span> {node.speaker}
          </div>
          <p className="dialog-text">{node.text}</p>
          {node.gift && giftName && <p className="dialog-gift">🎁 {giftName}!</p>}
          <span className="dialog-next">▼ 터치해서 계속</span>
        </div>
      ) : (
        <div className="dialog-box">
          <p className="dialog-text">{node.prompt}</p>
          <ChoiceList
            items={node.options.map((o) => ({
              key: o.label,
              label: o.label,
              onPick: () => onChoose(o),
            }))}
          />
        </div>
      )}
    </div>
  );
}
