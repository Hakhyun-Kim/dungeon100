import { ALL_UPGRADES } from '../lib/upgrades';
import { DEX_EVENTS, DEX_MOBS, dexCount, dexPct, dexTotal, DEX_MILESTONES, type DexState } from '../lib/dex';
import { PrimaryButton } from './Menu';

// 도감 「채워지는 책」 — 만난 것들이 책의 페이지로 기록된다. 미발견은 ??? 실루엣.
export default function DexScreen({ dex, claimed, onBack }: { dex: DexState; claimed: number; onBack: () => void }) {
  const items = new Set(dex.items);
  const mobs = new Set(dex.mobs);
  const events = new Set(dex.events);
  const pct = dexPct(dex);

  const cell = (found: boolean, icon: string, name: string, desc: string, key: string) => (
    <div key={key} className={`dex-entry${found ? ' found' : ''}`} title={found ? desc : '아직 만나지 못했다'}>
      <span className="dex-icon">{found ? icon : '❓'}</span>
      <span className="dex-name">{found ? name : '???'}</span>
    </div>
  );

  return (
    <div className="screen dex-screen">
      <h2>📖 채워지는 책</h2>
      <p className="quiz-sub">
        만난 것들이 페이지로 남는다 — <b>{dexCount(dex)}</b> / {dexTotal()} ({pct}%)
      </p>
      <div className="dex-milestones">
        {DEX_MILESTONES.map((m, i) => (
          <span key={m.pct} className={`set-chip${pct >= m.pct ? ' done' : ''}`}>
            {m.pct}% {i < claimed ? `🪙${m.coins} ✓` : `→ 🪙${m.coins}`}
          </span>
        ))}
      </div>

      <p className="dex-sec">🎁 보물 ({[...items].filter((i) => ALL_UPGRADES.some((u) => u.id === i)).length}/{ALL_UPGRADES.length})</p>
      <div className="dex-grid">
        {ALL_UPGRADES.map((u) => cell(items.has(u.id), u.icon, u.name, u.desc, u.id))}
      </div>

      <p className="dex-sec">👹 몬스터 ({[...mobs].filter((i) => DEX_MOBS.some((m) => m.id === i)).length}/{DEX_MOBS.length})</p>
      <div className="dex-grid">
        {DEX_MOBS.map((m) => cell(mobs.has(m.id), m.icon, m.name, m.desc, m.id))}
      </div>

      <p className="dex-sec">🕯️ 사건 ({[...events].filter((i) => DEX_EVENTS.some((e) => e.id === i)).length}/{DEX_EVENTS.length})</p>
      <div className="dex-grid">
        {DEX_EVENTS.map((e) => cell(events.has(e.id), e.icon, e.name, e.desc, e.id))}
      </div>

      <PrimaryButton onPick={onBack}>돌아가기</PrimaryButton>
    </div>
  );
}
