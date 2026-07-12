import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import DungeonScene, { type QuizResult } from './three/DungeonScene';
import DoorRunScene from './three/DoorRunScene';
import { BASE_STATS, UPGRADES, draftThree, type Stats, type Upgrade } from './lib/upgrades';
import { makeQuiz } from './lib/quiz';
import { mulberry32 } from './lib/rng';
import { useLocalStorage } from './lib/store';

// doorrun: 보물상자에 닿으면 시작되는 "두 문 달리기" 미니게임 (통과해야만 아이템 획득)
type Phase = 'title' | 'run' | 'doorrun' | 'quiz' | 'draft' | 'over';
type QuizView = 'ok' | 'no';

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [floorNo, setFloorNo] = useState(1);
  const [stats, setStats] = useState<Stats>(BASE_STATS);
  const [hp, setHp] = useState(BASE_STATS.maxHp);
  const [kills, setKills] = useState(0);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useLocalStorage<number>('d100-best', 0);
  const [flash, setFlash] = useState(0);
  const [goldFlash, setGoldFlash] = useState(0);
  const [build, setBuild] = useState<Record<string, number>>({});
  const [quizSeq, setQuizSeq] = useState(0);
  const [quizView, setQuizView] = useState<QuizView>('no');
  const [reward, setReward] = useState<Upgrade | null>(null);

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const pausedRef = useRef(false);
  pausedRef.current = phase !== 'run';
  const quizResultRef = useRef<QuizResult | null>(null);

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

  const quizSeed = runId * 104729 + floorNo * 131 + quizSeq * 17 + 5;
  const quiz = useMemo(() => makeQuiz(quizSeed, floorNo), [quizSeed, floorNo]);

  const startRun = () => {
    setFloorNo(1);
    setStats(BASE_STATS);
    setHp(BASE_STATS.maxHp);
    setKills(0);
    setBuild({});
    setQuizSeq(0);
    quizResultRef.current = null;
    setRunId((id) => id + 1);
    setPhase('run');
  };

  const gainUpgrade = (u: Upgrade) => {
    setStats((s) => u.apply(s));
    if (u.id === 'hp') setHp((h) => h + 25);
    setBuild((b) => ({ ...b, [u.id]: (b[u.id] ?? 0) + 1 }));
  };

  const onDamage = useCallback((dmg: number) => {
    setFlash((f) => f + 1);
    setHp((h) => Math.max(0, h - dmg));
  }, []);
  const onKill = useCallback(() => setKills((k) => k + 1), []);
  const onExit = useCallback(() => setPhase('draft'), []);
  const onChest = useCallback(() => setPhase('doorrun'), []);

  const pickUpgrade = (u: Upgrade) => {
    gainUpgrade(u);
    setFloorNo((n) => n + 1);
    setPhase('run');
  };

  // 두 문 달리기 결과 — 정답 문을 몸으로 통과했을 때만 보물 지급
  const onDoorRunDone = (ok: boolean) => {
    if (ok) {
      const pick = UPGRADES[Math.floor(mulberry32(quizSeed + 99)() * UPGRADES.length)];
      setReward(pick);
      gainUpgrade(pick);
      setGoldFlash((f) => f + 1);
      setQuizView('ok');
    } else {
      setReward(null);
      setQuizView('no');
    }
    setPhase('quiz');
  };

  const continueFromQuiz = () => {
    quizResultRef.current = { seq: quizSeq + 1, ok: quizView === 'ok' };
    setQuizSeq((s) => s + 1);
    setPhase('run');
  };

  const hpRatio = Math.max(0, Math.min(1, hp / stats.maxHp));

  return (
    <div className="app">
      {phase !== 'title' && (
        <Canvas className="canvas" camera={{ fov: 50, position: [0, 15.5, 9.5] }} dpr={[1, 2]}>
          <color attach="background" args={['#140e22']} />
          <fog attach="fog" args={['#140e22', 20, 44]} />
          <DungeonScene
            key={`${runId}:${floorNo}`}
            floorNo={floorNo}
            hidden={phase === 'doorrun'}
            statsRef={statsRef}
            pausedRef={pausedRef}
            quizResultRef={quizResultRef}
            onDamage={onDamage}
            onKill={onKill}
            onExit={onExit}
            onChest={onChest}
          />
          {phase === 'doorrun' && <DoorRunScene quiz={quiz} onDone={onDoorRunDone} />}
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

      {/* 현재 빌드 (획득한 아이템) */}
      {phase !== 'title' && Object.keys(build).length > 0 && (
        <div className="build-row">
          {UPGRADES.filter((u) => build[u.id]).map((u) => (
            <span key={u.id} className="build-chip">
              {u.icon}
              {build[u.id] > 1 && <em>×{build[u.id]}</em>}
            </span>
          ))}
        </div>
      )}

      {flash > 0 && <div key={`f${flash}`} className="hit-flash" />}
      {goldFlash > 0 && <div key={`g${goldFlash}`} className="hit-flash gold" />}

      {phase === 'title' && (
        <div className="screen title-screen">
          <h1>백층 던전</h1>
          <p className="tagline">매판 새로 만들어지는 던전 — 100층까지 내려가라!</p>
          <div className="howto">
            <p>🕹️ 이동: 화면 드래그 (PC는 WASD/방향키)</p>
            <p>⚔️ 공격: 가까운 적을 자동으로 조준</p>
            <p>🗝️ 보물상자에 닿으면 두 문 달리기 — 정답 문을 통과해야 아이템 획득!</p>
            <p>🌀 보라색 포털에 닿으면 다음 층 + 보상 선택</p>
          </div>
          {best > 0 && <p className="best">최고 기록: {best}층</p>}
          <button className="big-btn" onClick={startRun}>
            던전 입장
          </button>
        </div>
      )}

      {phase === 'doorrun' && (
        <div className="doorrun-hint">
          🚪 정답 문으로 달려요! (화면 왼쪽/오른쪽 꾹 또는 ←/→)
        </div>
      )}

      {phase === 'quiz' && (
        <div className="screen quiz-screen">
          {quizView === 'ok' && reward && (
            <>
              <h2>🎉 정답! 보물을 얻었다</h2>
              <div className="card reward-pop">
                <span className="card-icon">{reward.icon}</span>
                <span className="card-name">{reward.name}</span>
                <span className="card-desc">{reward.desc}</span>
              </div>
              <button className="big-btn" onClick={continueFromQuiz}>
                계속 탐험
              </button>
            </>
          )}
          {quizView === 'no' && (
            <>
              <h2>💨 아쉽다! 정답은 {quiz.answers[quiz.correct]}</h2>
              <p className="quiz-sub">상자가 먼지가 되어 사라졌다…</p>
              <button className="big-btn" onClick={continueFromQuiz}>
                계속 탐험
              </button>
            </>
          )}
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
