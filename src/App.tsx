import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import DungeonScene, { dungeonTheme, type QuizResult } from './three/DungeonScene';
import DoorRunScene from './three/DoorRunScene';
import GemArenaScene, { ARENA_MAX_HP } from './three/GemArenaScene';
import TownScene, {
  villageStage,
  VILLAGE_STAGE_NAMES,
  VILLAGE_STAGE_BG,
  type TownTarget,
} from './three/TownScene';
import { BASE_STATS, SPEED_CAP, UPGRADES, draftThree, type Stats, type Upgrade } from './lib/upgrades';
import { makeQuiz, type DungeonMode } from './lib/quiz';
import { mulberry32 } from './lib/rng';
import { useLocalStorage } from './lib/store';
import { sfx, isMuted, setMuted } from './lib/sound';
import { music } from './lib/music';
import { shareCard } from './lib/shareCard';
import {
  STORY_NODES,
  MEMORIES,
  ENDING_ALONE,
  ENDING_TOGETHER,
  ENDING_GIRL_EXTRA,
  ENDING_NAME_PRINCESS,
  ENDING_EPILOGUE,
  TRACES,
  girlScript,
  getLore,
  getDeathLore,
  chiefTalk,
  ninaTalk,
  mukTalk,
  entranceOptions,
  type TownContext,
  type TownNode,
} from './lib/story';

// 대장간 영구 강화 (죽어도 유지 — localStorage d100-meta)
interface Meta {
  dmg: number;
  hp: number;
  spd: number;
}
// 레벨 상한 없음 — 비용이 (lv+1)×25로 계속 오르는 무한 단련. 신속만 소프트 캡(아래 metaSpeed).
const SHOP_ITEMS: { key: keyof Meta; icon: string; name: string; desc: string }[] = [
  { key: 'dmg', icon: '⚔️', name: '공격 단련', desc: '시작 공격력 +2' },
  { key: 'hp', icon: '💖', name: '생명 단련', desc: '시작 체력 +15' },
  { key: 'spd', icon: '👟', name: '신속 단련', desc: '시작 이동 증가 (갈수록 완만)' },
];
const shopCost = (lv: number) => (lv + 1) * 25;
// 신속 단련은 레벨당 캡까지 남은 거리의 8%씩 — 1레벨은 예전과 같은 +0.4, 무한 구매해도 캡(12) 안쪽.
const metaSpeed = (lv: number) => SPEED_CAP - (SPEED_CAP - BASE_STATS.speed) * Math.pow(0.92, lv);

// 흐름: title → story(인트로) → town(마을) → run
//  - 보물상자(수학 모드): run → doorrun(두 문 달리기, 최대 3연속) → quiz(결과) → memory(되찾은 기억) → run
//  - 보물상자(몬스터 모드): run → arena(무리 처치+보석 3개) → quiz(보상) / arenaover(쓰러짐 → 재도전·포기) → memory → run
//  - 층 이동: run → portal(내려갈지 선택) → draft(보상 3택 1) → lore(벽의 글귀) → run(다음 층)
//  - 5층마다: run → homedoor(마을 문 선택) → town(방문 — 층 유지) → run
type Phase =
  | 'title'
  | 'story'
  | 'town'
  | 'village'
  | 'run'
  | 'doorrun'
  | 'arena'
  | 'arenaover'
  | 'quiz'
  | 'memory'
  | 'memfull'
  | 'portal'
  | 'draft'
  | 'lore'
  | 'homedoor'
  | 'shop'
  | 'trace'
  | 'ending'
  | 'over';
type QuizView = 'ok' | 'no' | 'choice';
const MAX_DOOR_ROUND = 3;

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [floorNo, setFloorNo] = useState(1);
  // 부활 체크포인트 — 마지막으로 다녀온 5층 단위 마을 층 (죽으면 여기서 다시 시작)
  const [checkpointFloor, setCheckpointFloor] = useState(1);
  const [stats, setStats] = useState<Stats>(BASE_STATS);
  const [hp, setHp] = useState(BASE_STATS.maxHp);
  const [kills, setKills] = useState(0);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useLocalStorage<number>('d100-best', 0);
  const [storySeen, setStorySeen] = useLocalStorage<boolean>('d100-story', false);
  const [memCount, setMemCount] = useLocalStorage<number>('d100-mem', 0);
  const [coins, setCoins] = useLocalStorage<number>('d100-coins', 0);
  const [meta, setMeta] = useLocalStorage<Meta>('d100-meta', { dmg: 0, hp: 0, spd: 0 });
  const [deaths, setDeaths] = useLocalStorage<number>('d100-deaths', 0);
  const [girlMet, setGirlMet] = useLocalStorage<boolean>('d100-girl', false);
  // 본 흔적(14·28·42·49층)의 층 번호 — 42층 초대장을 봤으면 56층 소녀의 첫인사·선물이 달라진다
  const [tracesSeen, setTracesSeen] = useLocalStorage<number[]>('d100-traces', []);
  const tracesSeenRef = useRef(tracesSeen);
  tracesSeenRef.current = tracesSeen;
  const [overLore, setOverLore] = useState('');
  const [townScape, setTownScape] = useState<{ sky: string; scape: string }>({
    sky: '🌙',
    scape: '🏔️ 🏚️ ⛲ 🏘️ 🌲',
  });
  const [flash, setFlash] = useState(0);
  const [goldFlash, setGoldFlash] = useState(0);
  const [build, setBuild] = useState<Record<string, number>>({});
  const [quizSeq, setQuizSeq] = useState(0);
  const [quizView, setQuizView] = useState<QuizView>('no');
  const [rewards, setRewards] = useState<Upgrade[]>([]);
  const [doorRound, setDoorRound] = useState(1);
  // 몬스터 아레나 (보물상자 '몬스터' 모드)
  const [arenaHp, setArenaHp] = useState(ARENA_MAX_HP);
  const [arenaMax, setArenaMax] = useState(ARENA_MAX_HP);
  const [arenaGems, setArenaGems] = useState(0);
  const [arenaTry, setArenaTry] = useState(0); // 재도전 시 씬 리마운트 key
  const [arenaDeathGems, setArenaDeathGems] = useState(0);
  const [storyIdx, setStoryIdx] = useState(0);
  const [townIdx, setTownIdx] = useState(0);
  const [townScript, setTownScript] = useState<TownNode[]>([]); // DOM 마을 화면(현재 56층 소녀 전용)
  const [townMode, setTownMode] = useState<'pre' | 'visit' | 'girl'>('pre');
  const [giftName, setGiftName] = useState<string | null>(null);
  // 걸어다니는 마을 (TownScene)
  const [villageCtx, setVillageCtx] = useState<TownContext>('enter');
  const [villageFirst, setVillageFirst] = useState(false);
  const [villageNear, setVillageNear] = useState<TownTarget>(null);
  const [villageTalk, setVillageTalk] = useState<{ script: TownNode[]; idx: number } | null>(null);
  const [mode, setMode] = useState<DungeonMode>('kids');
  const [muted, setMutedState] = useState(isMuted());
  const [bossHp, setBossHp] = useState(0);
  const [bossMax, setBossMax] = useState(0);
  const [storyAnswer, setStoryAnswer] = useState<'ok' | 'no' | null>(null);
  const [memRewards, setMemRewards] = useState<Upgrade[]>([]);
  const [endingVariant, setEndingVariant] = useState<'alone' | 'together' | null>(null);
  const [endingIdx, setEndingIdx] = useState(0);

  // 디버그 (Shift+D): 개발 모드 또는 ?debug 쿼리에서만 (제출 심사자 오작동 방지)
  const debugAllowed = useMemo(
    () => import.meta.env.DEV || new URLSearchParams(location.search).has('debug'),
    [],
  );
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugFloor, setDebugFloor] = useState('');

  // ── 자동 시연 모드 (?demo) — 클릭 한 번이면 게임이 스스로 쇼케이스를 진행 (심사·시연용).
  //    프로덕션에서도 동작 (DEV 훅과 무관하게 App 내부 함수 + 합성 키 입력으로 조종).
  const demoMode = useMemo(() => new URLSearchParams(location.search).has('demo'), []);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoCaption, setDemoCaption] = useState('');
  const [demoDone, setDemoDone] = useState(false);

  const statsRef = useRef(stats);
  statsRef.current = stats;
  const floorNoRef = useRef(floorNo);
  floorNoRef.current = floorNo;
  const phaseRef = useRef(phase); // 자동 시연 드라이버가 최신 phase 참조
  phaseRef.current = phase;
  const modeRef = useRef(mode); // onChest(useCallback) 안에서 최신 모드 참조
  modeRef.current = mode;
  const pausedRef = useRef(false);
  pausedRef.current = phase !== 'run' || debugOpen;
  // 마을에선 대화창이 열려 있을 때만 이동 정지 (그 외엔 자유롭게 걸어다님)
  const villagePausedRef = useRef(false);
  villagePausedRef.current = villageTalk !== null || debugOpen;
  const quizResultRef = useRef<QuizResult | null>(null);
  const portalRetryRef = useRef(0);
  const homeRetryRef = useRef(0);
  const homeUsedRef = useRef(0);
  const visitGiftGiven = useRef<Set<number>>(new Set()); // 방문당 노드별 선물 1회

  // 사망 판정은 hp 변화에 반응 (이벤트 콜백을 안정적으로 유지하기 위함)
  useEffect(() => {
    if (phase === 'run' && hp <= 0) {
      setPhase('over');
      if (floorNo > best) setBest(floorNo);
      setOverLore(getDeathLore(deaths)); // 죽을수록 위화감이 커진다
      setDeaths(deaths + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hp, phase]);

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
    else if (phase === 'arena') sfx.roar();
    else if (phase === 'memory') sfx.memory();
    else if (phase === 'lore') sfx.lore();
    else if (phase === 'portal') sfx.portal();
    else if (phase === 'homedoor') sfx.bell();
    else if (phase === 'over') sfx.over();
    else if (phase === 'ending') sfx.unlock();
  }, [phase]);

  // BGM — 상황별 트랙 (던전은 깊이에 따라 템포·음색 변화, 보스 생존 중엔 보스 트랙)
  useEffect(() => {
    if (muted) {
      music.stop();
      return;
    }
    if (phase === 'title' || phase === 'story' || phase === 'ending' || phase === 'memfull') {
      music.play('title');
    } else if (phase === 'town' || phase === 'village') {
      music.play('town');
    } else if (phase === 'doorrun') {
      music.play('doorrun');
    } else if (phase === 'arena' || phase === 'arenaover') {
      music.play('boss', Math.floor((floorNo - 1) / 5));
    } else if (phase === 'over') {
      music.stop();
    } else {
      music.play(bossHp > 0 ? 'boss' : 'dungeon', Math.floor((floorNo - 1) / 5));
    }
  }, [phase, muted, floorNo, bossHp]);

  // 위기 연출 — 체력 30% 미만이면 심장박동
  const hpRatioNow = stats.maxHp > 0 ? hp / stats.maxHp : 1;
  const lowHp =
    phase !== 'title' && phase !== 'story' && phase !== 'town' && hp > 0 && hpRatioNow < 0.3;
  useEffect(() => {
    if (!lowHp || muted) return;
    sfx.heartbeat();
    const iv = setInterval(() => sfx.heartbeat(), 1000);
    return () => clearInterval(iv);
  }, [lowHp, muted]);

  // 층/판이 바뀌면 보스 체력바 초기화 (보스 층이면 씬이 다시 보고함)
  useEffect(() => {
    setBossHp(0);
    setBossMax(0);
  }, [floorNo, runId]);

  // 엔딩 진입 시 선택 초기화
  useEffect(() => {
    if (phase === 'ending') {
      setEndingVariant(null);
      setEndingIdx(0);
      if (100 > best) setBest(100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // 개발 검증용 (프로덕션 제외): 층 점프
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__d100app = {
      jump: (n: number) => {
        setFloorNo(n);
        setPhase('run');
      },
    };
  }, []);

  // 디버그 보물 (Shift+P): 보물방 클리어(전설)와 동일 — 아이템 3개 + 완전 회복.
  // 핸들러 useEffect는 [debugAllowed] 고정이라 ref로 최신 phase·grantRewards를 본다.
  const debugGrantRef = useRef(() => {});
  debugGrantRef.current = () => {
    if (phase !== 'run') return;
    grantRewards(MAX_DOOR_ROUND, Math.floor(Math.random() * 1e9)); // 누를 때마다 다른 아이템
  };

  // 디버그 단축키: Shift+D 층 이동 열고 닫기, Shift+P 보물, Shift+M 코인 +100, Esc 닫기 (한/영 무관 e.code)
  useEffect(() => {
    if (!debugAllowed) return;
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyD' && e.shiftKey) {
        e.preventDefault();
        setDebugOpen((o) => !o);
      } else if (e.code === 'KeyP' && e.shiftKey) {
        e.preventDefault();
        debugGrantRef.current();
      } else if (e.code === 'KeyM' && e.shiftKey) {
        e.preventDefault();
        sfx.gift();
        setCoins((c) => c + 100); // 대장간(메타 강화) 테스트용 — 코인은 localStorage라 죽어도 유지
      } else if (e.key === 'Escape') {
        setDebugOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [debugAllowed]);

  // 오버레이 키보드 선택 — 마우스 없이 화살표/숫자/Enter로 즉시 선택
  //  · 두 갈래 선택(두 문 보상, 포털, 마을 문 등): ←/↑ = 첫 번째, →/↓ = 두 번째
  //  · 3장 카드(드래프트): ← / ↑↓ / → 또는 1·2·3
  //  · 진행 버튼(계속 탐험 등): Enter/Space/→
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (debugOpen) return;
      // 자동 반복(키를 누르고 있을 때) 입력은 무시 — 이동하려고 누른 채로 포털·대화 화면이
      // 떠도 눌러져 있던 키가 자동으로 선택되지 않게. 한 번 떼었다 다시 눌러야 반응한다.
      if (e.repeat) return;
      const k = e.key;
      const isEnter = k === 'Enter' || k === ' ';
      const isLeft = k === 'ArrowLeft';
      const isRight = k === 'ArrowRight';
      const isUp = k === 'ArrowUp';
      const isDown = k === 'ArrowDown';
      const num = ['1', '2', '3', '4'].indexOf(k);
      if (!isEnter && !isLeft && !isRight && !isUp && !isDown && num < 0) return;

      const buttons = (sel: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(sel)].filter((b) => !b.disabled);
      const click = (b?: HTMLButtonElement) => {
        if (b) {
          e.preventDefault();
          b.click();
        }
      };
      // 두 갈래/여러 갈래 선택지
      const choices = buttons('.screen .dialog-choices .choice-btn, .story-quiz-choices .choice-btn');
      if (choices.length >= 2) {
        if (num >= 0) return click(choices[num]);
        if (isLeft || isUp) return click(choices[0]);
        if (isRight || isDown) return click(choices[1]);
        return;
      }
      // 드래프트 카드 3장
      const cards = buttons('.draft-screen .card');
      if (cards.length >= 2) {
        if (num >= 0) return click(cards[num]);
        if (isLeft) return click(cards[0]);
        if (isUp || isDown) return click(cards[1]);
        if (isRight) return click(cards[cards.length - 1]);
        return;
      }
      // 진행 버튼 하나 (계속 탐험, 가슴에 담는다, 다음 등)
      const primary = buttons('.screen .big-btn');
      if (primary.length >= 1 && (isEnter || isRight)) return click(primary[0]);
      // 마을(비주얼노벨/걸어다니는 마을) 대사 진행
      if ((phase === 'town' || phase === 'village') && (isEnter || isRight)) {
        const dlg = document.querySelector<HTMLElement>(
          '.town-screen .dialog-box, .village-talk .dialog-box',
        );
        if (dlg && dlg.querySelector('.dialog-next')) {
          e.preventDefault();
          dlg.click();
          return;
        }
        // 대화창이 없으면 근처 상호작용 버튼 (말 걸기/던전 입구) — Enter/Space만.
        // →는 이동 키라 여기서 반응하면 걷다가 대화가 열려 버림.
        const act = document.querySelector<HTMLButtonElement>('.village-action');
        if (phase === 'village' && act && isEnter) {
          e.preventDefault();
          act.click();
        }
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [phase, debugOpen]);

  const debugJump = (n: number) => {
    if (!Number.isFinite(n)) return;
    const fl = Math.max(1, Math.min(100, Math.round(n)));
    sfx.tap();
    setFloorNo(fl);
    setHp(statsRef.current.maxHp); // 이동 시 회복 (테스트 편의)
    setDebugOpen(false);
    setPhase('run');
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    music.sync();
    if (!next) sfx.tap();
  };

  const memory = MEMORIES[memCount % MEMORIES.length];

  const enterDungeon = (m?: DungeonMode) => {
    if (m) setMode(m);
    sfx.enter();
    setStorySeen(true);
    setFloorNo(1);
    setCheckpointFloor(1); // 새 도전 — 체크포인트 초기화
    // 대장간 영구 강화 반영
    const startStats: Stats = {
      ...BASE_STATS,
      damage: BASE_STATS.damage + meta.dmg * 2,
      maxHp: BASE_STATS.maxHp + meta.hp * 15,
      speed: metaSpeed(meta.spd),
    };
    setStats(startStats);
    setHp(startStats.maxHp);
    setKills(0);
    setOverLore('');
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
      goVillage('enter');
    } else {
      setStoryIdx(0);
      setPhase('story');
    }
  };

  // 걸어다니는 마을로 진입 (허브·5층 방문·부활 공용)
  const goVillage = (ctx: TownContext, first = false) => {
    setVillageCtx(ctx);
    setVillageFirst(first);
    setVillageNear(null);
    setVillageTalk(null);
    setPhase('village');
  };
  const onVillageNear = useCallback((t: TownTarget) => setVillageNear(t), []);

  // 마을에서 NPC/입구에 다가가 상호작용 버튼을 누르면 그에 맞는 대화 스크립트를 연다
  const talkTo = (target: TownTarget) => {
    if (!target) return;
    sfx.tap();
    let script: TownNode[] = [];
    // 시절 연동 대사는 villageFloor 기준 (enter 허브는 0 = 평화로운 시절)
    if (target === 'chief') script = chiefTalk(villageCtx, villageFirst, villageFloor);
    else if (target === 'nina') script = ninaTalk(villageCtx, villageFloor);
    else if (target === 'muk') script = mukTalk(villageFloor);
    else if (target === 'entrance') script = entranceOptions(villageCtx, floorNo);
    if (!script.length) return;
    applyVillageGift(script[0]);
    setVillageTalk({ script, idx: 0 });
  };

  // 대화 노드에 선물(gift)이 있으면 1회 지급 (여관 수프 = 완전 회복)
  const villageGiftDone = useRef<Set<TownNode>>(new Set());
  const applyVillageGift = (node: TownNode) => {
    if (node.kind !== 'line' || !node.gift || villageGiftDone.current.has(node)) return;
    villageGiftDone.current.add(node);
    if (node.gift === 'heal') {
      setHp(stats.maxHp);
      setGiftName('🍲 체력 완전 회복');
      setGoldFlash((f) => f + 1);
      sfx.gift();
    } else {
      const u = UPGRADES[Math.floor(mulberry32(runId * 41 + floorNo * 13 + 7)() * UPGRADES.length)];
      gainUpgrade(u);
      setGiftName(`${u.icon} ${u.name} 획득`);
      setGoldFlash((f) => f + 1);
      sfx.gift();
    }
  };

  const closeTalk = () => setVillageTalk(null);

  // 대화 진행 — line은 next(<0이면 종료), choice는 action 처리
  const advanceTalkLine = (node: Extract<TownNode, { kind: 'line' }>) => {
    sfx.tap();
    if (node.next < 0 || !villageTalk || node.next >= villageTalk.script.length) {
      closeTalk();
      return;
    }
    const nextNode = villageTalk.script[node.next];
    applyVillageGift(nextNode);
    setVillageTalk({ script: villageTalk.script, idx: node.next });
  };
  const chooseTalkOption = (o: {
    label: string;
    next?: number;
    action?: 'enter' | 'return' | 'shop' | 'close';
    mode?: DungeonMode;
  }) => {
    sfx.tap();
    if (o.action === 'enter') {
      closeTalk();
      enterDungeon(o.mode); // 던전 입구 → 난이도 선택 → 1층부터 새 도전
    } else if (o.action === 'return') {
      closeTalk();
      setPhase('run'); // 이어서 내려가기 (5층 방문·부활 — floorNo는 이미 설정됨)
    } else if (o.action === 'shop') {
      closeTalk();
      setPhase('shop');
    } else if (o.action === 'close') {
      closeTalk();
    } else if (o.next != null && villageTalk) {
      const nextNode = villageTalk.script[o.next];
      applyVillageGift(nextNode);
      setVillageTalk({ script: villageTalk.script, idx: o.next });
    } else {
      closeTalk();
    }
  };

  const replayStory = () => {
    sfx.tap();
    setStoryIdx(0);
    setPhase('story');
  };

  const goTown = (
    script: TownNode[],
    mode: 'pre' | 'visit' | 'girl' = 'pre',
    scape?: { sky: string; scape: string },
  ) => {
    setTownScript(script);
    setTownIdx(0);
    setTownMode(mode);
    setGiftName(null);
    visitGiftGiven.current.clear();
    setTownScape(scape ?? { sky: '🌙', scape: '🏔️ 🏚️ ⛲ 🏘️ 🌲' });
    setPhase('town');
  };

  const gainUpgrade = (u: Upgrade) => {
    setStats((s) => u.apply(s));
    if (u.id === 'hp') setHp((h) => h + 25);
    setBuild((b) => ({ ...b, [u.id]: (b[u.id] ?? 0) + 1 }));
  };

  // 통과한 문 수(tier)만큼 보물 지급 — 3문 완주는 전설 보물(전부 + 완전 회복)
  const grantRewards = (tier: number, seed = quizSeed + 991) => {
    const rand = mulberry32(seed);
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

  // 마을 방문 선물 (대화 노드에 gift가 달려 있으면 노드당 1회 지급)
  const townNode = townScript[townIdx];
  useEffect(() => {
    if (phase !== 'town' || townMode === 'pre') return;
    if (!townNode || townNode.kind !== 'line' || !townNode.gift) return;
    if (visitGiftGiven.current.has(townIdx)) return;
    visitGiftGiven.current.add(townIdx);
    if (townNode.gift === 'heal') {
      setHp(stats.maxHp);
      setGiftName('🍲 체력 완전 회복');
    } else {
      // townIdx를 시드에 섞음 — 한 대화에 선물 노드가 둘이어도(예: 소녀 초대 답례) 다른 아이템
      const u =
        UPGRADES[Math.floor(mulberry32(runId * 31 + floorNo * 7 + townIdx * 5 + 11)() * UPGRADES.length)];
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
  const onKill = useCallback(
    (bounty: number) => {
      sfx.kill();
      setKills((k) => k + 1);
      setCoins((c) => c + bounty);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // 100층의 출구는 포털이 아니라 집으로 가는 문 — 엔딩으로
  const onExit = useCallback(
    () => setPhase(floorNoRef.current >= 100 ? 'ending' : 'portal'),
    [],
  );
  const onBossHp = useCallback((hpNow: number, maxHp: number) => {
    setBossHp(hpNow);
    setBossMax(maxHp);
  }, []);
  const quizSeedRef = useRef(quizSeed);
  quizSeedRef.current = quizSeed;
  // 보스 처치 — 확정 보물 1개 + 회복 30 + 코인 25, 포털 봉인 해제
  const onBossDown = useCallback(() => {
    const pick = UPGRADES[Math.floor(mulberry32(quizSeedRef.current + 777)() * UPGRADES.length)];
    const next = pick.apply(statsRef.current);
    setStats(next);
    setHp((h) => Math.min(next.maxHp, h + 30 + (pick.id === 'hp' ? 25 : 0)));
    setBuild((b) => ({ ...b, [pick.id]: (b[pick.id] ?? 0) + 1 }));
    setRewards([pick]);
    setCoins((c) => c + 25);
    setGoldFlash((f) => f + 1);
    sfx.legend();
    sfx.unlock();
    setQuizView('ok');
    setPhase('quiz');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onChest = useCallback(() => {
    if (modeRef.current === 'monster') {
      // 몬스터 모드 — 보물상자는 몬스터 아레나를 연다
      setArenaGems(0);
      setArenaHp(ARENA_MAX_HP);
      setArenaMax(ARENA_MAX_HP);
      setArenaTry((t) => t + 1);
      setPhase('arena');
    } else {
      setDoorRound(1);
      setPhase('doorrun');
    }
  }, []);
  const onHomeDoor = useCallback(() => setPhase('homedoor'), []);
  const onTrace = useCallback(() => {
    sfx.memory();
    const fl = floorNoRef.current;
    setTracesSeen((prev) => (prev.includes(fl) ? prev : [...prev, fl]));
    setPhase('trace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onGirl = useCallback(() => {
    sfx.gift();
    setGirlMet(true);
    goTown(girlScript(tracesSeenRef.current.includes(42)), 'girl', {
      sky: '✨',
      scape: '🕯️ 🫖 📚 🌼 🕯️',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── 몬스터 아레나 결과 (DoorRunScene처럼 매 렌더 새 콜백을 넘겨도 r3f가 최신을 호출)
  const onArenaHp = (hpNow: number, max: number) => {
    setArenaHp(hpNow);
    setArenaMax(max);
  };
  const onArenaGem = (n: number) => setArenaGems(n);
  const onArenaDone = (cleared: boolean, gems: number) => {
    if (cleared) {
      // 보석 3개 완수 = 전설 보물 (아이템 3개 + 완전 회복)
      grantRewards(MAX_DOOR_ROUND);
      setQuizView('ok');
      setPhase('quiz');
    } else {
      // 쓰러짐 — 본체는 무사, 재도전할지 물어본다
      setArenaDeathGems(gems);
      setPhase('arenaover');
    }
  };
  const retryArena = () => {
    sfx.tap();
    setArenaGems(0);
    setArenaHp(ARENA_MAX_HP);
    setArenaMax(ARENA_MAX_HP);
    setArenaTry((t) => t + 1);
    setPhase('arena');
  };
  const bailArena = () => {
    sfx.tap();
    if (arenaDeathGems > 0) {
      grantRewards(arenaDeathGems); // 모은 보석 수만큼 보상
      setQuizView('ok');
    } else {
      setRewards([]);
      setQuizView('no');
    }
    setPhase('quiz');
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
    const newCount = memCount + 1;
    setMemCount(newCount);
    if (newCount === MEMORIES.length) {
      // 열두 개의 기억을 모두 되찾음 — 완성 보상
      const rand = mulberry32(runId * 53 + 12);
      const pool = [...UPGRADES];
      const picks: Upgrade[] = [];
      for (let i = 0; i < 2 && pool.length > 0; i++) {
        picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      }
      const next = picks.reduce((s, u) => u.apply(s), stats);
      setStats(next);
      setHp(next.maxHp);
      setBuild((b) => {
        const nb = { ...b };
        picks.forEach((u) => (nb[u.id] = (nb[u.id] ?? 0) + 1));
        return nb;
      });
      setMemRewards(picks);
      setGoldFlash((f) => f + 1);
      sfx.legend();
      setPhase('memfull');
    } else {
      setPhase('run');
    }
  };

  const stayOnFloor = () => {
    sfx.tap();
    portalRetryRef.current += 1;
    setPhase('run');
  };

  const buyUpgrade = (key: keyof Meta) => {
    const lv = meta[key];
    const cost = shopCost(lv);
    if (coins < cost) {
      sfx.tap();
      return;
    }
    setCoins((c) => c - cost);
    setMeta({ ...meta, [key]: lv + 1 });
    setGoldFlash((f) => f + 1);
    sfx.treasure();
  };

  const openHomeDoor = () => {
    sfx.tap();
    homeUsedRef.current += 1;
    setCheckpointFloor(floorNo); // 이 마을을 다녀갔으니 부활 지점 갱신
    goVillage('visit');
  };

  const skipHomeDoor = () => {
    sfx.tap();
    homeRetryRef.current += 1;
    setPhase('run');
  };

  // 죽으면 1층이 아니라 마지막으로 다녀온 마을(체크포인트)에서 부활 — 장비 유지·완전 회복.
  // 주민들이 맞아 주고, 거기서 다시 던전으로 내려간다. ('죽음=다시 쓰임' 세계관과 연결)
  const resumeFromCheckpoint = () => {
    sfx.tap();
    setFloorNo(checkpointFloor);
    setHp(stats.maxHp); // 부활 — 완전 회복 (스탯·빌드는 유지)
    setDoorRound(1);
    quizResultRef.current = null;
    setRunId((id) => id + 1); // 씬 강제 리마운트 (같은 층에서 죽어도 새로 시작)
    goVillage('death');
  };

  // ── 자동 시연 드라이버 (?demo) — 실제 게임을 그대로 플레이하며 자막과 함께 보여준다.
  //    이동은 합성 키보드 이벤트(useMoveInput/useSteer가 window 키 이벤트 기반이라 그대로 먹힘),
  //    장면 전환은 App 내부 함수(goVillage/enterDungeon/debugJump/debugGrantRef)로 직접 진행.
  //    DEV 훅을 안 쓰므로 프로덕션 빌드에서도 동작 — 심사자가 링크 클릭 한 번으로 관람.
  useEffect(() => {
    if (!demoRunning) return;
    let stop = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const key = (code: string, down: boolean) =>
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    const releaseAll = () => ['ArrowLeft', 'ArrowRight', ...MOVE_KEYS].forEach((c) => key(c, false));
    const OVERLAYS = ['lore', 'memory', 'trace', 'quiz', 'portal', 'draft', 'homedoor', 'memfull', 'arenaover', 'over'];
    // 떠 있는 오버레이를 잠깐 보여준 뒤 자연스럽게 넘긴다 (스토리도 시연의 일부)
    const clickOverlay = () => {
      const card = document.querySelector<HTMLButtonElement>('.draft-screen .card');
      if (card) return card.click();
      const choices = [
        ...document.querySelectorAll<HTMLButtonElement>('.screen .dialog-choices .choice-btn'),
      ].filter((b) => !b.disabled);
      // 포털·마을 문은 거절 — 시연 동선은 드라이버가 debugJump로 직접 잡는다
      if (choices.length >= 2 && (phaseRef.current === 'portal' || phaseRef.current === 'homedoor'))
        return choices[1].click();
      if (choices.length > 0) return choices[0].click();
      document.querySelector<HTMLButtonElement>('.screen .big-btn')?.click();
    };
    const settle = async () => {
      if (OVERLAYS.includes(phaseRef.current)) {
        await sleep(1500); // 관객이 읽을 시간
        if (!stop) clickOverlay();
        await sleep(400);
      }
    };
    // 무작위 산책 — 전투·마을 구경용 (자동 조준이 알아서 싸운다)
    const wander = async (ms: number) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !stop) {
        await settle();
        const c = MOVE_KEYS[Math.floor(Math.random() * MOVE_KEYS.length)];
        key(c, true);
        await sleep(450 + Math.random() * 450);
        key(c, false);
      }
      releaseAll();
    };
    // 원하는 phase가 될 때까지 오버레이를 넘기며 대기 (두 문 달리기 중이면 조향도)
    const settleUntil = async (want: string[], maxMs: number) => {
      const until = Date.now() + maxMs;
      while (Date.now() < until && !stop && !want.includes(phaseRef.current)) {
        if (phaseRef.current === 'doorrun') {
          const c = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
          key(c, true);
          await sleep(320);
          key(c, false);
          continue;
        }
        await settle();
        await sleep(300);
      }
    };
    const caption = async (text: string) => {
      setDemoCaption(text);
      sfx.tap();
      await sleep(1900);
    };

    const tour = async () => {
      await caption('🏘️ 모험은 걸어다니는 마을에서 — NPC와 대화하고 던전 입구로!');
      goVillage('enter');
      await wander(5500);
      if (stop) return;

      await caption('⚔️ 매판 새로 생성되는 던전 — 가까운 적은 자동 조준!');
      enterDungeon('kids');
      await wander(7500);
      if (stop) return;

      await caption('🎁 보물은 빌드로 바로 보입니다 — 궤도 구슬, 커지는 투사체!');
      for (let i = 0; i < 3 && !stop; i++) {
        debugGrantRef.current();
        await sleep(1200);
      }
      await wander(3500);
      if (stop) return;

      await caption('🚪 미니게임 ① 두 문 달리기 — 정답이 적힌 문을 몸으로!');
      setDoorRound(1);
      setPhase('doorrun');
      {
        const until = Date.now() + 11000;
        while (Date.now() < until && !stop && phaseRef.current === 'doorrun') {
          const c = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
          key(c, true);
          await sleep(320 + Math.random() * 320);
          key(c, false);
        }
        releaseAll();
      }
      await settleUntil(['run'], 12000); // 결과·기억 회상까지 넘기고 던전 복귀
      if (stop) return;

      await caption('👹 미니게임 ② 몬스터 아레나 — 무리를 뚫고 보석 3개!');
      setArenaGems(0);
      setArenaHp(ARENA_MAX_HP);
      setArenaMax(ARENA_MAX_HP);
      setArenaTry((t) => t + 1);
      setPhase('arena');
      await wander(11000);
      if (stop) return;

      await caption('🌊 깊이 = 이야기의 진행 — 10층마다 던전의 색이 변하고 안개가 짙어집니다');
      debugJump(45);
      await sleep(300);
      debugGrantRef.current();
      await wander(6000);
      debugJump(75);
      await sleep(300);
      debugGrantRef.current();
      await wander(6000);
      if (stop) return;

      await caption('🌅 깊이 내려가면 마을에도 시간이 흐릅니다 — 습격, 방벽, 그리고 폐허와 새벽');
      setFloorNo(85);
      goVillage('visit');
      await wander(7000);
      if (stop) return;

      await caption('📖 10층마다 페이지의 수호자가 포털을 봉인합니다 — 탄막을 뚫어라!');
      debugJump(30);
      await sleep(300);
      debugGrantRef.current();
      await wander(12000);
      if (stop) return;

      await caption('✨ 56층의 소녀, 100층의 황금 문, 엔딩과 에필로그는 — 직접 확인해 보세요!');
      await sleep(2600);
      releaseAll();
      setPhase('title');
      setDemoCaption('');
      setDemoRunning(false);
      setDemoDone(true);
    };
    void tour();
    return () => {
      stop = true;
      releaseAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRunning]);

  // 마을의 '시절' — 새 도전 허브(enter)는 언제나 처음의 평화로운 마을, 그 외엔 현재 깊이.
  // 깊이 내려갈수록(=마지막 장이 쓰일수록) 마을에도 시간이 흐른다 (계절·습격 피해·새벽).
  const villageFloor = villageCtx === 'enter' ? 0 : floorNo;
  const vStage = villageStage(villageFloor);
  // 배경·안개 — 마을은 시절 색, 미니게임은 기본, 던전은 10층 단위 테마 색.
  // 던전 안개는 깊을수록 짙어진다(시야 축소 = 미로 난이도 램프): near 20→11, far 44→28.
  const inMinigame = phase === 'doorrun' || phase === 'arena' || phase === 'arenaover';
  const canvasBg =
    phase === 'village' ? VILLAGE_STAGE_BG[vStage] : inMinigame ? '#140e22' : dungeonTheme(floorNo).bg;
  const fogDepth = Math.min(1, floorNo / 100);
  const fogNear = phase === 'village' || inMinigame ? 20 : 20 - 9 * fogDepth;
  const fogFar = phase === 'village' || inMinigame ? 44 : 44 - 16 * fogDepth;

  const hpRatio = Math.max(0, Math.min(1, hp / stats.maxHp));
  const inGame = !(
    phase === 'title' ||
    phase === 'story' ||
    phase === 'shop' ||
    (phase === 'town' && townMode === 'pre')
  );

  return (
    <div className="app">
      {inGame && (
        <Canvas className="canvas" camera={{ fov: 50, position: [0, 15.5, 9.5] }} dpr={[1, 2]}>
          <color attach="background" args={[canvasBg]} />
          <fog attach="fog" args={[canvasBg, fogNear, fogFar]} />
          <DungeonScene
            key={`${runId}:${floorNo}`}
            floorNo={floorNo}
            hidden={
              phase === 'doorrun' ||
              phase === 'arena' ||
              phase === 'arenaover' ||
              phase === 'village'
            }
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
            onBossHp={onBossHp}
            onBossDown={onBossDown}
            onTrace={onTrace}
            onGirl={onGirl}
          />
          {phase === 'doorrun' && (
            <DoorRunScene key={doorRound} quiz={quiz} onDone={onDoorRunDone} />
          )}
          {phase === 'arena' && (
            <GemArenaScene
              key={arenaTry}
              floorNo={floorNo}
              statsRef={statsRef}
              onArenaHp={onArenaHp}
              onGem={onArenaGem}
              onDone={onArenaDone}
            />
          )}
          {phase === 'village' && (
            <TownScene
              key={`v${villageFloor}`}
              floorNo={villageFloor}
              pausedRef={villagePausedRef}
              onNear={onVillageNear}
            />
          )}
        </Canvas>
      )}

      {inGame &&
        phase !== 'town' &&
        phase !== 'village' &&
        phase !== 'arena' &&
        phase !== 'arenaover' && (
        <div className="hud">
          <div className="hud-chip">
            {mode === 'kids' ? '🎒' : mode === 'adult' ? '🧠' : '👹'} {floorNo}층
          </div>
          <div className="hp-wrap">
            <div className="hp-bar" style={{ width: `${hpRatio * 100}%` }} />
            <span className="hp-text">
              {Math.ceil(hp)} / {Math.round(stats.maxHp)}
            </span>
          </div>
          <div className="hud-chip">💀 {kills}</div>
          <div className="hud-chip">🪙 {coins}</div>
          <button className="hud-chip mute-btn" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {/* 몬스터 아레나 HUD — 아레나 전용 체력 + 보석 진행도 */}
      {phase === 'arena' && (
        <div className="hud">
          <div className="hud-chip">👹 아레나</div>
          <div className="hp-wrap">
            <div
              className="hp-bar"
              style={{ width: `${Math.max(0, (arenaHp / arenaMax) * 100)}%` }}
            />
            <span className="hp-text">
              {Math.ceil(arenaHp)} / {arenaMax}
            </span>
          </div>
          <div className="hud-chip">💎 {arenaGems} / 3</div>
          <button className="hud-chip mute-btn" onClick={toggleMute}>
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {/* 걸어다니는 마을 — 상단 안내 + 상호작용 버튼 + 대화창 */}
      {phase === 'village' && (
        <>
          <div className="hud">
            <div className="hud-chip">{VILLAGE_STAGE_NAMES[vStage]}</div>
            <div className="hud-spacer" />
            <button className="hud-chip mute-btn" onClick={toggleMute}>
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
          {!villageTalk && (
            <div className="village-hint">
              드래그 / WASD로 걷기 · 사람에게 다가가 대화 · 던전 입구로 가면 내려가요
            </div>
          )}
          {villageNear && !villageTalk && (
            <button className="village-action" onClick={() => talkTo(villageNear)}>
              {villageNear === 'entrance'
                ? '🌀 던전 입구 — 내려가기'
                : villageNear === 'chief'
                  ? '💬 촌장과 대화'
                  : villageNear === 'nina'
                    ? '💬 니나와 대화'
                    : '💬 무크와 대화'}
            </button>
          )}
          {villageTalk &&
            (() => {
              const node = villageTalk.script[villageTalk.idx];
              if (!node) return null;
              return (
                <div className="screen village-talk">
                  {node.kind === 'line' ? (
                    <div className="dialog-box" onClick={() => advanceTalkLine(node)}>
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
                      <div className="dialog-choices">
                        {node.options.map((o) => (
                          <button
                            key={o.label}
                            className="choice-btn"
                            onClick={() => chooseTalkOption(o)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
        </>
      )}

      {/* 현재 빌드 (획득한 아이템) */}
      {inGame && phase !== 'town' && phase !== 'village' && Object.keys(build).length > 0 && (
        <div className="build-row">
          {UPGRADES.filter((u) => build[u.id]).map((u) => (
            <span key={u.id} className="build-chip">
              {u.icon}
              {build[u.id] > 1 && <em>×{build[u.id]}</em>}
            </span>
          ))}
        </div>
      )}

      {/* 보스 체력바 — 마을(town/village)에서는 숨김 (숨은 DungeonScene이 보고해도 표시 안 함) */}
      {inGame && phase !== 'town' && phase !== 'village' && bossMax > 0 && bossHp > 0 && (
        <div className="boss-bar-wrap">
          <span className="boss-label">📖 페이지의 수호자</span>
          <div className="boss-bar-outer">
            <div className="boss-bar" style={{ width: `${(bossHp / bossMax) * 100}%` }} />
          </div>
        </div>
      )}

      {/* 전체 화면 플래시·펄스는 디버그 모드에서 끔 — 반복 테스트 시 눈 피로 (소리 신호는 유지) */}
      {!debugAllowed && flash > 0 && <div key={`f${flash}`} className="hit-flash" />}
      {!debugAllowed && goldFlash > 0 && <div key={`g${goldFlash}`} className="hit-flash gold" />}
      {!debugAllowed && lowHp && <div className="low-hp" />}

      {/* 디버그 층 이동 (Shift+D — DEV 또는 ?debug) */}
      {debugAllowed && debugOpen && runId > 0 && (
        <div className="screen debug-screen">
          <h2>🛠️ 디버그 — 층 이동</h2>
          <div className="debug-grid">
            {[1, 5, 10, 20, 30, 50, 56, 70, 90, 100].map((n) => (
              <button key={n} className="choice-btn debug-jump" onClick={() => debugJump(n)}>
                {n}층
              </button>
            ))}
          </div>
          <div className="debug-row">
            <input
              className="debug-input"
              type="number"
              min={1}
              max={100}
              placeholder="층 번호"
              value={debugFloor}
              onChange={(e) => setDebugFloor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && debugFloor) debugJump(Number(debugFloor));
              }}
            />
            <button
              className="choice-btn"
              onClick={() => debugFloor && debugJump(Number(debugFloor))}
            >
              이동
            </button>
          </div>
          <p className="quiz-sub">
            Shift+D 열기/닫기 · Esc 닫기 · 이동하면 체력 회복 · Shift+P 보물(아이템 3개+회복) ·
            Shift+M 코인 +100
          </p>
          <button className="skip-btn" onClick={() => setDebugOpen(false)}>
            닫기
          </button>
        </div>
      )}

      {/* 자동 시연 (?demo) — 자막·종료 버튼·끝 화면 */}
      {demoRunning && demoCaption && <div className="demo-caption">{demoCaption}</div>}
      {demoRunning && (
        <button className="demo-exit" onClick={() => (location.href = location.pathname)}>
          ✕ 시연 종료
        </button>
      )}
      {demoMode && demoDone && !demoRunning && (
        <div className="screen demo-end">
          <h2>🎬 시연 끝!</h2>
          <p className="quiz-sub">
            방금 본 것은 절반도 안 됩니다 — 56층의 소녀 '여백', 층층이 숨은 흔적과 벽의 글귀,
            <br />
            100층의 황금 문과 두 가지 엔딩, 그리고 10년 후의 에필로그….
          </p>
          <div className="dialog-choices">
            <button
              className="choice-btn"
              onClick={() => {
                sfx.tap();
                setDemoDone(false);
                setDemoRunning(true);
              }}
            >
              🔁 다시 보기
            </button>
            <button className="choice-btn" onClick={() => (location.href = location.pathname)}>
              🎮 직접 플레이하러 가기
            </button>
          </div>
        </div>
      )}

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
          {demoMode && (
            <button
              className="big-btn demo-start"
              onClick={() => {
                sfx.enter();
                setDemoDone(false);
                setDemoRunning(true);
              }}
            >
              🎬 자동 시연 보기 (약 90초)
            </button>
          )}
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

      {phase === 'story' &&
        (() => {
          const node = STORY_NODES[storyIdx];
          const isLast = storyIdx >= STORY_NODES.length - 1;
          const advance = () => {
            sfx.tap();
            setStoryAnswer(null);
            if (isLast) goVillage('enter', true);
            else setStoryIdx((i) => i + 1);
          };
          const quizPending = node.kind === 'quiz' && storyAnswer === null;
          return (
            <div className="screen story-screen" onClick={() => !quizPending && advance()}>
              <div className="story-icon">{node.icon}</div>
              {node.kind === 'slide' && <p className="story-text">{node.text}</p>}
              {node.kind === 'quiz' && storyAnswer === null && (
                <>
                  <p className="story-text">{node.intro}</p>
                  <h2 className="story-quiz-q">{node.q}</h2>
                  <div className="dialog-choices story-quiz-choices">
                    {node.answers.map((a, i) => (
                      <button
                        key={a}
                        className="choice-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (i === node.correct) {
                            sfx.pass();
                            setStoryAnswer('ok');
                          } else {
                            sfx.crash();
                            setStoryAnswer('no');
                          }
                        }}
                      >
                        🚪 {a}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {node.kind === 'quiz' && storyAnswer !== null && (
                <p className="story-text">{storyAnswer === 'ok' ? node.okText : node.noText}</p>
              )}
              <div className="story-btns">
                {!quizPending && (
                  <button
                    className="big-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      advance();
                    }}
                  >
                    {isLast ? '마을로 가 본다' : '다음 ▶'}
                  </button>
                )}
                <button
                  className="skip-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.tap();
                    setStoryAnswer(null);
                    goVillage('enter', true);
                  }}
                >
                  건너뛰기 ⏭
                </button>
              </div>
              <p className="story-page">
                {storyIdx + 1} / {STORY_NODES.length}
              </p>
            </div>
          );
        })()}

      {phase === 'town' && townNode && (
        <div className="screen town-screen">
          <div className="town-sky">{townScape.sky}</div>
          <div className="town-scape">{townScape.scape}</div>
          {townMode === 'visit' && <div className="town-floor-chip">🔔 {floorNo}층의 문 → 마을</div>}
          {townMode === 'girl' && <div className="town-floor-chip">🍵 {floorNo}층 — 페이지 사이의 찻자리</div>}
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
                      else if (o.action === 'shop') setPhase('shop');
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

      {phase === 'arena' && (
        <div className="doorrun-hint">
          💎 보석 3개를 모아라! 무리를 뚫고 몸으로 줍기 (드래그 / WASD) — 쓰러져도 다시 도전 가능
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

      {phase === 'arenaover' && (
        <div className="screen quiz-screen">
          <h2>💥 아레나에서 쓰러졌다</h2>
          <p className="quiz-sub">
            하지만 본체는 무사하다 — 이 상자는 몇 번이고 다시 도전할 수 있다.
            {arenaDeathGems > 0 && (
              <>
                <br />
                지금까지 💎 {arenaDeathGems}개를 모았다.
              </>
            )}
          </p>
          <div className="dialog-choices">
            <button className="choice-btn" onClick={retryArena}>
              🔁 다시 도전 (보석 초기화)
            </button>
            <button className="choice-btn" onClick={bailArena}>
              {arenaDeathGems > 0
                ? `🎁 여기까지 — 보석 ${arenaDeathGems}개 받기`
                : '🏳️ 포기하고 나간다'}
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
                {rewards.length >= MAX_DOOR_ROUND
                  ? mode === 'monster'
                    ? '🏆 세 보석의 축복!'
                    : '🏆 전설의 보물이다!'
                  : '🎉 보물을 얻었다!'}
              </h2>
              {rewards.length >= MAX_DOOR_ROUND && (
                <p className="quiz-sub">
                  {mode === 'monster'
                    ? '세 개의 보석을 모두 손에 넣었다! 체력도 가득 찼다.'
                    : '세 개의 문을 모두 통과! 체력도 가득 찼다.'}
                </p>
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
              {mode === 'monster' ? (
                <>
                  <h2>💨 보석을 하나도 줍지 못했다…</h2>
                  <p className="quiz-sub">무리에 밀려 빈손으로 물러났다. 상자가 먼지가 되어 사라졌다…</p>
                </>
              ) : (
                <>
                  <h2>💨 아쉽다! 정답은 {quiz.answers[quiz.correct]}</h2>
                  <p className="quiz-sub">
                    {doorRound > 1
                      ? `${doorRound - 1}개의 문을 통과했지만… 보물은 전부 먼지가 되었다.`
                      : '상자가 먼지가 되어 사라졌다…'}
                  </p>
                </>
              )}
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

      {phase === 'memfull' && (
        <div className="screen memory-screen">
          <div className="memory-icon">💫</div>
          <h2 className="memory-title">모든 기억을 되찾았다!</h2>
          <p className="memory-text">
            열두 개의 기억이 가슴 속에서 빛난다.{'\n'}이제 이 던전이 앗아갈 수 있는 것은, 아무것도
            없다.
          </p>
          <div className="cards">
            {memRewards.map((u, i) => (
              <div key={`${u.id}${i}`} className="card reward-pop">
                <span className="card-icon">{u.icon}</span>
                <span className="card-name">{u.name}</span>
                <span className="card-desc">{u.desc}</span>
              </div>
            ))}
          </div>
          <p className="memory-count">체력도 가득 찼다</p>
          <button
            className="big-btn"
            onClick={() => {
              sfx.tap();
              setPhase('run');
            }}
          >
            힘이 차오른다!
          </button>
        </div>
      )}

      {phase === 'ending' &&
        (() => {
          if (endingVariant === null) {
            return (
              <div className="screen ending-screen">
                <div className="story-icon">🚪</div>
                <h2>황금빛 문이 열려 있다</h2>
                <p className="story-text">
                  100층 — 페이지의 수호자는 쓰러졌고,{'\n'}이 문을 넘으면, 집이다.
                </p>
                <div className="dialog-choices story-quiz-choices">
                  <button
                    className="choice-btn"
                    onClick={() => {
                      sfx.tap();
                      setEndingVariant('alone');
                    }}
                  >
                    🚶 혼자 문을 연다
                  </button>
                  <button
                    className="choice-btn"
                    onClick={() => {
                      sfx.tap();
                      setEndingVariant('together');
                    }}
                  >
                    👵 촌장을 데리러 간다
                  </button>
                </div>
              </div>
            );
          }
          const baseSlides = endingVariant === 'alone' ? ENDING_ALONE : ENDING_TOGETHER;
          // 여백을 만났으면: 함께 엔딩엔 '공주의 이름' 장면, 모든 엔딩에 손 흔드는 장면.
          // 그 뒤로 10년 후 에필로그(2탄 예고)는 공통.
          const slides = [
            ...baseSlides,
            ...(girlMet && endingVariant === 'together' ? [ENDING_NAME_PRINCESS] : []),
            ...(girlMet ? [ENDING_GIRL_EXTRA] : []),
            ...ENDING_EPILOGUE,
          ];
          if (endingIdx < slides.length) {
            const s = slides[endingIdx];
            return (
              <div
                className="screen ending-screen"
                onClick={() => {
                  sfx.tap();
                  setEndingIdx((i) => i + 1);
                }}
              >
                <div className="story-icon">{s.icon}</div>
                <p className="story-text">{s.text}</p>
                <button
                  className="big-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    sfx.tap();
                    setEndingIdx((i) => i + 1);
                  }}
                >
                  다음 ▶
                </button>
              </div>
            );
          }
          return (
            <div className="screen ending-screen">
              <h1 className="ending-title">— 끝 —</h1>
              <p className="story-text">
                🏰 100층 완주 · 💀 처치 {kills} · 💭 되찾은 기억{' '}
                {Math.min(memCount, MEMORIES.length)} / {MEMORIES.length}
              </p>
              <p className="quiz-sub">당신이 이 책의 마지막 장을 썼다.</p>
              <button
                className="big-btn"
                onClick={() => {
                  sfx.tap();
                  setPhase('title');
                }}
              >
                처음부터
              </button>
              <button
                className="skip-btn"
                onClick={() => {
                  sfx.tap();
                  void shareCard({
                    floor: 100,
                    kills,
                    mem: memCount,
                    memMax: MEMORIES.length,
                    best,
                    mode,
                    cleared: true,
                  });
                }}
              >
                📸 완주 카드 저장
              </button>
            </div>
          );
        })()}

      {phase === 'trace' && TRACES[floorNo] && (
        <div className="screen lore-screen">
          <div className="story-icon">{TRACES[floorNo].icon}</div>
          <p className="lore-label">{floorNo}층 — 누군가의 흔적</p>
          <p className="lore-text">{TRACES[floorNo].text}</p>
          <button
            className="big-btn"
            onClick={() => {
              sfx.tap();
              setPhase('run');
            }}
          >
            …계속 가 보자
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
          <p className="over-lore">{overLore}</p>
          <p className="quiz-sub">🪙 {coins} — 코인은 사라지지 않았다. 이야기도, 이어진다.</p>
          <div className="dialog-choices">
            {checkpointFloor >= 5 ? (
              <button className="choice-btn" onClick={resumeFromCheckpoint}>
                🏘️ {checkpointFloor}층 마을에서 다시 (장비 유지)
              </button>
            ) : (
              <button className="choice-btn" onClick={() => enterDungeon()}>
                ⚔️ 바로 다시 도전
              </button>
            )}
            <button className="choice-btn" onClick={() => goVillage('enter')}>
              🏘️ 처음부터 (마을·대장간 🛠️)
            </button>
          </div>
          <button
            className="skip-btn"
            onClick={() => {
              sfx.tap();
              void shareCard({ floor: floorNo, kills, mem: memCount, memMax: MEMORIES.length, best, mode });
            }}
          >
            📸 기록 카드 저장
          </button>
        </div>
      )}

      {phase === 'shop' && (
        <div className="screen town-screen">
          <div className="town-sky">🌙</div>
          <div className="town-scape">🔥 ⚒️ 🛠️ 🧱</div>
          <div className="dialog-box">
            <div className="dialog-speaker">
              <span className="dialog-icon">🧔</span> 대장장이 무크
            </div>
            <p className="dialog-text">
              "죽어도 몸에 남는 단련이지. 코인만 있으면 몇 번이고 벼려 주마."
            </p>
            <p className="shop-coins">보유 🪙 {coins}</p>
            <div className="dialog-choices">
              {SHOP_ITEMS.map((it) => {
                const lv = meta[it.key];
                const cost = shopCost(lv);
                return (
                  <button
                    key={it.key}
                    className="choice-btn shop-item"
                    disabled={coins < cost}
                    onClick={() => buyUpgrade(it.key)}
                  >
                    <span>
                      {it.icon} {it.name} Lv.{lv}
                    </span>
                    <span className="shop-cost">{`${it.desc} · 🪙 ${cost}`}</span>
                  </button>
                );
              })}
              <button
                className="choice-btn"
                onClick={() => {
                  sfx.tap();
                  setPhase('village');
                }}
              >
                ↩️ 마을로 돌아간다
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
