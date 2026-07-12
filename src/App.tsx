import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import DungeonScene, { type QuizResult } from './three/DungeonScene';
import DoorRunScene from './three/DoorRunScene';
import { BASE_STATS, UPGRADES, draftThree, type Stats, type Upgrade } from './lib/upgrades';
import { makeQuiz, type DungeonMode } from './lib/quiz';
import { mulberry32 } from './lib/rng';
import { useLocalStorage } from './lib/store';
import { sfx, isMuted, setMuted } from './lib/sound';
import {
  STORY_SLIDES,
  TOWN_FIRST,
  TOWN_ENTRY,
  TOWN_REVISIT,
  MEMORIES,
  getLore,
  townVisitScript,
  type TownNode,
} from './lib/story';

// 흐름: title → story(인트로) → town(마을) → run
//  - 보물상자: run → doorrun(두 문 달리기, 최대 3연속) → quiz(결과) → memory(되찾은 기억) → run
//  - 층 이동: run → portal(내려갈지 선택) → draft(보상 3택 1) → lore(벽의 글귀) → run(다음 층)
//  - 5층마다: run → homedoor(마을 문 선택) → town(방문 — 층 유지) → run
type Phase =
  | 'title'
  | 'story'
  | 'town'
  | 'run'
  | 'doorrun'
  | 'quiz'
  | 'memory'
  | 'portal'
  | 'draft'
  | 'lore'
  | 'homedoor'
  | 'over';
type QuizView = 'ok' | 'no' | 'choice';
const MAX_DOOR_ROUND = 3;

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [floorNo, setFloorNo] = useState(1);
  const [stats, setStats] = useState<Stats>(BASE_STATS);
  const [hp, setHp] = useState(BASE_STATS.maxHp);
  const [kills, setKills] = useState(0);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useLocalStorage<number>('d100-best', 0);
  const [storySeen, setStorySeen] = useLocalStorage<boolean>('d100-story', false);
  const [memCount, setMemCount] = useLocalStorage<number>('d100-mem', 0);
  const [flash, setFlash] = useState(0);
  const [goldFlash, setGoldFlash] = useState(0);
  const [build, setBuild] = useState<Record<string, number>>({});
  const [quizSeq, setQuizSeq] = useState(0);
  const [quizView, setQuizView] = useState<QuizView>('no');
  const [rewards, setRewards] = useState<Upgrade[]>([]);
  const [doorRound, setDoorRound] = useState(1);
  const [storyIdx, setStoryIdx] = useState(0);
  const [townIdx, setTownIdx] = useState(0);
  const [townScript, setTownScript] = useState<TownNode[]>(TOWN_FIRST);
  const [townMode, setTownMode] = useState<'pre' | 'visit'>('pre');
  const [giftName, setGiftName] = useState<string | null>(null);
  const [mode, setMode] = useState<DungeonMode>('kids');
  const [muted, setMutedState] = useState(isMuted());

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const pausedRef = useRef(false);
  pausedRef.current = phase !== 'run';
  const quizResultRef = useRef<QuizResult | null>(null);
  const portalRetryRef = useRef(0);
  const homeRetryRef = useRef(0);
  const homeUsedRef = useRef(0);
  const visitGiftGiven = useRef(false);

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

  // 문(라운드)마다 새 문제 — 깊은 라운드일수록 어려운 문제 등급, 던전 종류에 따라 수준 조절
  const quizSeed = runId * 104729 + floorNo * 131 + quizSeq * 17 + doorRound * 7 + 5;
  const quiz = useMemo(
    () => makeQuiz(quizSeed, floorNo + (doorRound - 1) * 6, mode),
    [quizSeed, floorNo, doorRound, mode],
  );

  // phase 전환 효과음
  useEffect(() => {
    if (phase === 'doorrun') sfx.doorrun();
    else if (phase === 'memory') sfx.memory();
    else if (phase === 'lore') sfx.lore();
    else if (phase === 'portal') sfx.portal();
    else if (phase === 'homedoor') sfx.bell();
    else if (phase === 'over') sfx.over();
  }, [phase]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) sfx.tap();
  };

  const memory = MEMORIES[memCount % MEMORIES.length];

  const enterDungeon = (m?: DungeonMode) => {
    if (m) setMode(m);
    sfx.enter();
    setStorySeen(true);
    setFloorNo(1);
    setStats(BASE_STATS);
    setHp(BASE_STATS.maxHp);
    setKills(0);
    setBuild({});
    setQuizSeq(0);
    setDoorRound(1);
    quizResultRef.current = null;
    portalRetryRef.current = 0;
    homeRetryRef.current = 0;
    homeUsedRef.current = 0;
    setRunId((id) => id + 1);
    setPhase('run');
  };

  const startAdventure = () => {
    sfx.tap();
    if (storySeen) {
      goTown(TOWN_ENTRY);
    } else {
      setStoryIdx(0);
      setPhase('story');
    }
  };

  const replayStory = () => {
    sfx.tap();
    setStoryIdx(0);
    setPhase('story');
  };

  const goTown = (script: TownNode[], mode: 'pre' | 'visit' = 'pre') => {
    setTownScript(script);
    setTownIdx(0);
    setTownMode(mode);
    setGiftName(null);
    visitGiftGiven.current = false;
    setPhase('town');
  };

  const gainUpgrade = (u: Upgrade) => {
    setStats((s) => u.apply(s));
    if (u.id === 'hp') setHp((h) => h + 25);
    setBuild((b) => ({ ...b, [u.id]: (b[u.id] ?? 0) + 1 }));
  };

  // 통과한 문 수(tier)만큼 보물 지급 — 3문 완주는 전설 보물(전부 + 완전 회복)
  const grantRewards = (tier: number) => {
    const rand = mulberry32(quizSeed + 991);
    const pool = [...UPGRADES];
    const picks: Upgrade[] = [];
    for (let i = 0; i < tier && pool.length > 0; i++) {
      picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    const next = picks.reduce((s, u) => u.apply(s), stats);
    setStats(next);
    const healed = picks.filter((u) => u.id === 'hp').length * 25;
    setHp((h) => (tier >= MAX_DOOR_ROUND ? next.maxHp : Math.min(next.maxHp, h + healed)));
    setBuild((b) => {
      const nb = { ...b };
      picks.forEach((u) => (nb[u.id] = (nb[u.id] ?? 0) + 1));
      return nb;
    });
    setRewards(picks);
    setGoldFlash((f) => f + 1);
    if (tier >= MAX_DOOR_ROUND) sfx.legend();
    else sfx.treasure();
  };

  // 마을 방문 선물 (대화 노드에 gift가 달려 있으면 1회 지급)
  const townNode = townScript[townIdx];
  useEffect(() => {
    if (phase !== 'town' || townMode !== 'visit') return;
    if (!townNode || townNode.kind !== 'line' || !townNode.gift) return;
    if (visitGiftGiven.current) return;
    visitGiftGiven.current = true;
    if (townNode.gift === 'heal') {
      setHp(stats.maxHp);
      setGiftName('🍲 체력 완전 회복');
    } else {
      const u = UPGRADES[Math.floor(mulberry32(runId * 31 + floorNo * 7 + 11)() * UPGRADES.length)];
      gainUpgrade(u);
      setGiftName(`${u.icon} ${u.name} 획득`);
    }
    setGoldFlash((f) => f + 1);
    sfx.gift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, townMode, townNode]);

  const onDamage = useCallback((dmg: number) => {
    sfx.hurt();
    setFlash((f) => f + 1);
    setHp((h) => Math.max(0, h - dmg));
  }, []);
  const onKill = useCallback(() => {
    sfx.kill();
    setKills((k) => k + 1);
  }, []);
  const onExit = useCallback(() => setPhase('portal'), []);
  const onChest = useCallback(() => {
    setDoorRound(1);
    setPhase('doorrun');
  }, []);
  const onHomeDoor = useCallback(() => setPhase('homedoor'), []);

  const pickUpgrade = (u: Upgrade) => {
    sfx.pick();
    gainUpgrade(u);
    setFloorNo((n) => n + 1);
    setPhase('lore'); // 새 층에 도착하면 벽의 글귀부터
  };

  // 두 문 달리기 결과 — 오답이면 그동안의 문도 전부 물거품 (빈손)
  const onDoorRunDone = (ok: boolean) => {
    if (!ok) {
      setRewards([]);
      setQuizView('no');
    } else if (doorRound >= MAX_DOOR_ROUND) {
      grantRewards(MAX_DOOR_ROUND);
      setQuizView('ok');
    } else {
      setQuizView('choice');
    }
    setPhase('quiz');
  };

  const takeRewardNow = () => {
    grantRewards(doorRound);
    setQuizView('ok');
  };

  const runDeeper = () => {
    setDoorRound((r) => r + 1);
    setPhase('doorrun');
  };

  const continueFromQuiz = () => {
    sfx.tap();
    const gotReward = rewards.length > 0;
    quizResultRef.current = { seq: quizSeq + 1, ok: gotReward };
    setQuizSeq((s) => s + 1);
    setDoorRound(1);
    setPhase(gotReward ? 'memory' : 'run'); // 보물 = 기억 하나가 돌아온다
  };

  const closeMemory = () => {
    sfx.tap();
    setMemCount(memCount + 1);
    setPhase('run');
  };

  const stayOnFloor = () => {
    sfx.tap();
    portalRetryRef.current += 1;
    setPhase('run');
  };

  const openHomeDoor = () => {
    sfx.tap();
    homeUsedRef.current += 1;
    goTown(townVisitScript(floorNo), 'visit');
  };

  const skipHomeDoor = () => {
    sfx.tap();
    homeRetryRef.current += 1;
    setPhase('run');
  };

  const hpRatio = Math.max(0, Math.min(1, hp / stats.maxHp));
  const inGame = !(phase === 'title' || phase === 'story' || (phase === 'town' && townMode === 'pre'));

  return (
    <div className="app">
      {inGame && (
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
            portalRetryRef={portalRetryRef}
            homeRetryRef={homeRetryRef}
            homeUsedRef={homeUsedRef}
            onDamage={onDamage}
            onKill={onKill}
            onExit={onExit}
            onChest={onChest}
            onHomeDoor={onHomeDoor}
          />
          {phase === 'doorrun' && (
            <DoorRunScene key={doorRound} quiz={quiz} onDone={onDoorRunDone} />
          )}
        </Canvas>
      )}

      {inGame && phase !== 'town' && (
        <div className="hud">
          <div className="hud-chip">
            {mode === 'kids' ? '🎒' : '🧠'} {floorNo}층
          </div>
          <div className="hp-wrap">
            <div className="hp-bar" style={{ width: `${hpRatio * 100}%` }} />
            <span className="hp-text">
              {Math.ceil(hp)} / {Math.round(stats.maxHp)}
            </span>
          </div>
          <div className="hud-chip">💀 {kills}</div>
          <button className="hud-chip mute-btn" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {/* 현재 빌드 (획득한 아이템) */}
      {inGame && phase !== 'town' && Object.keys(build).length > 0 && (
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
          <button className="hud-chip mute-btn title-mute" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
          <h1>백층 던전</h1>
          <p className="tagline">책 속으로 떨어진 대학생의 귀환 대작전 — 100층까지 내려가라!</p>
          <div className="howto">
            <p>🕹️ 이동: 화면 드래그 (PC는 WASD/방향키)</p>
            <p>⚔️ 공격: 가까운 적을 자동으로 조준</p>
            <p>🗝️ 보물상자 = 두 문 달리기! 깊이 달릴수록 좋은 보물</p>
            <p>🌀 포털로 다음 층 — 내려갈지는 당신의 선택</p>
          </div>
          {best > 0 && <p className="best">최고 기록: {best}층 · 되찾은 기억 {Math.min(memCount, MEMORIES.length)}개</p>}
          <button className="big-btn" onClick={startAdventure}>
            모험 시작
          </button>
          {storySeen && (
            <button className="skip-btn" onClick={replayStory}>
              📖 스토리 다시 보기
            </button>
          )}
        </div>
      )}

      {phase === 'story' && (
        <div className="screen story-screen" onClick={() => setStoryIdx((i) => Math.min(i + 1, STORY_SLIDES.length - 1))}>
          <div className="story-icon">{STORY_SLIDES[storyIdx].icon}</div>
          <p className="story-text">{STORY_SLIDES[storyIdx].text}</p>
          <div className="story-btns">
            {storyIdx < STORY_SLIDES.length - 1 ? (
              <button
                className="big-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setStoryIdx((i) => i + 1);
                }}
              >
                다음 ▶
              </button>
            ) : (
              <button
                className="big-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  goTown(TOWN_FIRST);
                }}
              >
                마을로 가 본다
              </button>
            )}
            <button
              className="skip-btn"
              onClick={(e) => {
                e.stopPropagation();
                goTown(TOWN_FIRST);
              }}
            >
              건너뛰기 ⏭
            </button>
          </div>
          <p className="story-page">
            {storyIdx + 1} / {STORY_SLIDES.length}
          </p>
        </div>
      )}

      {phase === 'town' && townNode && (
        <div className="screen town-screen">
          <div className="town-sky">🌙</div>
          <div className="town-scape">🏔️ 🏚️ ⛲ 🏘️ 🌲</div>
          {townMode === 'visit' && <div className="town-floor-chip">🔔 {floorNo}층의 문 → 마을</div>}
          {townNode.kind === 'line' ? (
            <div
              className="dialog-box"
              onClick={() => {
                sfx.tap();
                setTownIdx(townNode.next);
              }}
            >
              <div className="dialog-speaker">
                <span className="dialog-icon">{townNode.icon}</span> {townNode.speaker}
              </div>
              <p className="dialog-text">{townNode.text}</p>
              {townNode.gift && giftName && <p className="dialog-gift">🎁 {giftName}!</p>}
              <span className="dialog-next">▼ 터치해서 계속</span>
            </div>
          ) : (
            <div className="dialog-box">
              <p className="dialog-text">{townNode.prompt}</p>
              <div className="dialog-choices">
                {townNode.options.map((o) => (
                  <button
                    key={o.label}
                    className="choice-btn"
                    onClick={() => {
                      sfx.tap();
                      if (o.action === 'enter') enterDungeon(o.mode);
                      else if (o.action === 'return') setPhase('run');
                      else setTownIdx(o.next ?? townIdx);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'doorrun' && (
        <div className="doorrun-hint">
          🚪 {doorRound}번째 문 / {MAX_DOOR_ROUND} — 정답 문으로 달려요! (화면 좌/우 꾹 또는 ←/→)
        </div>
      )}

      {phase === 'portal' && (
        <div className="screen quiz-screen">
          <h2>🌀 아래로 내려가는 포털이 열려 있다</h2>
          <p className="quiz-sub">다음 층은 더 위험하다. {floorNo + 1}층으로 내려가시겠습니까?</p>
          <div className="dialog-choices">
            <button
              className="choice-btn"
              onClick={() => {
                sfx.tap();
                setPhase('draft');
              }}
            >
              ⬇️ 내려간다
            </button>
            <button className="choice-btn" onClick={stayOnFloor}>
              🕐 아직 이 층을 더 둘러볼래
            </button>
          </div>
        </div>
      )}

      {phase === 'homedoor' && (
        <div className="screen quiz-screen">
          <h2>🔔 어디선가 은은한 종소리…</h2>
          <p className="quiz-sub">
            따뜻한 빛이 새어 나오는 나무 문이다. 마을로 이어지는 것 같다.
            <br />
            (5층마다 나타난다는 그 문인가? 왜 있는지는 아무도 모른다.)
          </p>
          <div className="dialog-choices">
            <button className="choice-btn" onClick={openHomeDoor}>
              🚪 문을 연다 — 마을에 들른다
            </button>
            <button className="choice-btn" onClick={skipHomeDoor}>
              🕯️ 지금은 던전에 집중한다
            </button>
          </div>
        </div>
      )}

      {phase === 'quiz' && (
        <div className="screen quiz-screen">
          {quizView === 'choice' && (
            <>
              <h2>🚪 {doorRound}번째 문 통과!</h2>
              <p className="quiz-sub">
                더 깊이 달릴수록 보물이 좋아진다… 하지만 틀리면 전부 빈손!
              </p>
              <div className="dialog-choices">
                <button className="choice-btn" onClick={takeRewardNow}>
                  🎁 여기서 보상 받기 — 아이템 {doorRound}개
                </button>
                <button className="choice-btn" onClick={runDeeper}>
                  {doorRound + 1 >= MAX_DOOR_ROUND
                    ? '🔥 마지막 문에 도전! (전설의 보물)'
                    : '🔥 더 달린다!'}
                </button>
              </div>
            </>
          )}
          {quizView === 'ok' && rewards.length > 0 && (
            <>
              <h2>
                {rewards.length >= MAX_DOOR_ROUND ? '🏆 전설의 보물이다!' : '🎉 보물을 얻었다!'}
              </h2>
              {rewards.length >= MAX_DOOR_ROUND && (
                <p className="quiz-sub">세 개의 문을 모두 통과! 체력도 가득 찼다.</p>
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
              <button className="big-btn" onClick={continueFromQuiz}>
                계속 탐험
              </button>
            </>
          )}
          {quizView === 'no' && (
            <>
              <h2>💨 아쉽다! 정답은 {quiz.answers[quiz.correct]}</h2>
              <p className="quiz-sub">
                {doorRound > 1
                  ? `${doorRound - 1}개의 문을 통과했지만… 보물은 전부 먼지가 되었다.`
                  : '상자가 먼지가 되어 사라졌다…'}
              </p>
              <button className="big-btn" onClick={continueFromQuiz}>
                계속 탐험
              </button>
            </>
          )}
        </div>
      )}

      {phase === 'memory' && (
        <div className="screen memory-screen">
          <p className="memory-label">보물의 빛이 스며들자, 잊고 있던 기억이 하나 돌아왔다</p>
          <div className="memory-icon">{memory.icon}</div>
          <h2 className="memory-title">{memory.title}</h2>
          <p className="memory-text">{memory.text}</p>
          <p className="memory-count">되찾은 기억 {Math.min(memCount + 1, MEMORIES.length)} / {MEMORIES.length}</p>
          <button className="big-btn" onClick={closeMemory}>
            가슴에 담는다
          </button>
        </div>
      )}

      {phase === 'lore' && (
        <div className="screen lore-screen">
          <p className="lore-label">🕯️ {floorNo}층 — 벽에 긁어 쓴 글씨가 보인다</p>
          <p className="lore-text">{getLore(floorNo)}</p>
          <button
            className="big-btn"
            onClick={() => {
              sfx.tap();
              setPhase('run');
            }}
          >
            계속 내려간다
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
          <p className="quiz-sub">눈을 떠 보니 마을 여관 침대 위였다. 던전의 마법일까.</p>
          <div className="dialog-choices">
            <button className="choice-btn" onClick={() => enterDungeon()}>
              ⚔️ 바로 다시 도전
            </button>
            <button className="choice-btn" onClick={() => goTown(TOWN_REVISIT)}>
              🏘️ 마을에서 한숨 돌리기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
