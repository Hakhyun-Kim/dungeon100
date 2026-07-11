import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import DungeonScene from './three/DungeonScene';
import { BASE_STATS, draftThree, type Stats, type Upgrade } from './lib/upgrades';
import { mulberry32 } from './lib/rng';
import { useLocalStorage } from './lib/store';

type Phase = 'title' | 'run' | 'draft' | 'over';

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [floorNo, setFloorNo] = useState(1);
  const [stats, setStats] = useState<Stats>(BASE_STATS);
  const [hp, setHp] = useState(BASE_STATS.maxHp);
  const [kills, setKills] = useState(0);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useLocalStorage<number>('d100-best', 0);
  const [flash, setFlash] = useState(0);

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const pausedRef = useRef(false);
  pausedRef.current = phase !== 'run';

  // 사망 판정은 hp 변화에 반응 (이벤트 콜백을 안정적으로 유지하기 위함)
  useEffect(() => {
    if (phase === 'run' && hp <= 0) {
      setPhase('over');
      if (floorNo > best) setBest(floorNo);
    }
  }, [hp, phase, floorNo, best, setBest]);

  const draft = useMemo(
    () => draftThree(mulberry32(runId * 7919 + floorNo * 131 + 7)),
    [runId, floorNo],
  );

  const startRun = () => {
    setFloorNo(1);
    setStats(BASE_STATS);
    setHp(BASE_STATS.maxHp);
    setKills(0);
    setRunId((id) => id + 1);
    setPhase('run');
  };

  const onDamage = useCallback((dmg: number) => {
    setFlash((f) => f + 1);
    setHp((h) => Math.max(0, h - dmg));
  }, []);
  const onKill = useCallback(() => setKills((k) => k + 1), []);
  const onExit = useCallback(() => setPhase('draft'), []);

  const pickUpgrade = (u: Upgrade) => {
    setStats((s) => u.apply(s));
    if (u.id === 'hp') setHp((h) => h + 25);
    setFloorNo((n) => n + 1);
    setPhase('run');
  };

  const hpRatio = Math.max(0, Math.min(1, hp / stats.maxHp));

  return (
    <div className="app">
      {phase !== 'title' && (
        <Canvas className="canvas" camera={{ fov: 50, position: [0, 15.5, 9.5] }} dpr={[1, 2]}>
          <DungeonScene
            key={`${runId}:${floorNo}`}
            floorNo={floorNo}
            statsRef={statsRef}
            pausedRef={pausedRef}
            onDamage={onDamage}
            onKill={onKill}
            onExit={onExit}
          />
        </Canvas>
      )}

      {phase !== 'title' && (
        <div className="hud">
          <div className="hud-chip">🏰 {floorNo}층</div>
          <div className="hp-wrap">
            <div className="hp-bar" style={{ width: `${hpRatio * 100}%` }} />
            <span className="hp-text">
              {Math.ceil(hp)} / {Math.round(stats.maxHp)}
            </span>
          </div>
          <div className="hud-chip">💀 {kills}</div>
        </div>
      )}

      {flash > 0 && <div key={flash} className="hit-flash" />}

      {phase === 'title' && (
        <div className="screen title-screen">
          <h1>백층 던전</h1>
          <p className="tagline">매판 새로 만들어지는 던전 — 100층까지 내려가라!</p>
          <div className="howto">
            <p>🕹️ 이동: 화면 드래그 (PC는 WASD/방향키)</p>
            <p>⚔️ 공격: 가까운 적을 자동으로 조준</p>
            <p>🌀 보라색 포털에 닿으면 다음 층 + 보상 선택</p>
          </div>
          {best > 0 && <p className="best">최고 기록: {best}층</p>}
          <button className="big-btn" onClick={startRun}>
            던전 입장
          </button>
        </div>
      )}

      {phase === 'draft' && (
        <div className="screen draft-screen">
          <h2>{floorNo}층 돌파! 보상을 골라요</h2>
          <div className="cards">
            {draft.map((u) => (
              <button key={u.id} className="card" onClick={() => pickUpgrade(u)}>
                <span className="card-icon">{u.icon}</span>
                <span className="card-name">{u.name}</span>
                <span className="card-desc">{u.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'over' && (
        <div className="screen over-screen">
          <h2>💀 {floorNo}층에서 쓰러졌다…</h2>
          <p>
            처치 {kills} · 최고 기록 {Math.max(best, floorNo)}층
          </p>
          <button className="big-btn" onClick={startRun}>
            다시 도전
          </button>
        </div>
      )}
    </div>
  );
}
