import { useEffect, useRef } from 'react';
import type { TownLine, TownNode, TownOption } from '../lib/story';
import type { TownTarget } from '../three/TownScene';
import { ChoiceList } from './Menu';

export interface VillageTalk {
  script: TownNode[];
  idx: number;
}

// 걸어다니는 마을(TownScene) 위 DOM — 조작 안내·상호작용 버튼·대화창.
// 키보드: 대사(line)는 Enter/Space/→ 진행, 근처 상호작용은 Enter/Space만
// (→는 이동 키라 걷다가 대화가 열리지 않게), 선택지는 ChoiceList 표준 메뉴.
export default function VillageOverlay({
  near,
  talk,
  giftName,
  keysLocked,
  onTalk,
  onAdvanceLine,
  onChoose,
}: {
  near: TownTarget;
  talk: VillageTalk | null;
  giftName: string | null;
  keysLocked: boolean;
  onTalk: (t: TownTarget) => void;
  onAdvanceLine: (node: TownLine) => void;
  onChoose: (o: TownOption) => void;
}) {
  const stateRef = useRef({ near, talk, keysLocked, onTalk, onAdvanceLine });
  stateRef.current = { near, talk, keysLocked, onTalk, onAdvanceLine };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (s.keysLocked || e.repeat) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const isEnter = e.key === 'Enter' || e.key === ' ';
      const node = s.talk?.script[s.talk.idx];
      if (node) {
        // 대사 진행 — 선택지(choice)는 ChoiceList가 처리
        if (node.kind === 'line' && (isEnter || e.key === 'ArrowRight')) {
          e.preventDefault();
          s.onAdvanceLine(node);
        }
        return;
      }
      if (s.near && isEnter) {
        e.preventDefault();
        s.onTalk(s.near);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const node = talk?.script[talk.idx];
  return (
    <>
      {!talk && (
        <div className="village-hint">
          드래그 / WASD로 걷기 · 사람에게 다가가 대화 · 던전 입구로 가면 내려가요
        </div>
      )}
      {near && !talk && (
        <button className="village-action" onClick={() => onTalk(near)}>
          {near === 'entrance'
            ? '🌀 던전 입구 — 내려가기'
            : near === 'chief'
              ? '💬 촌장과 대화'
              : near === 'nina'
                ? '💬 니나와 대화'
                : '💬 무크와 대화'}
        </button>
      )}
      {talk && node && (
        <div className="screen village-talk">
          {node.kind === 'line' ? (
            <div className="dialog-box" onClick={() => onAdvanceLine(node)}>
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
      )}
    </>
  );
}
