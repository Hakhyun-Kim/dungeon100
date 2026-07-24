import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import DungeonScene, { dungeonTheme, type QuizResult } from './three/DungeonScene';
import DoorRunScene from './three/DoorRunScene';
import GemArenaScene, { ARENA_MAX_HP } from './three/GemArenaScene';
import TownScene, {
  villageStage,
  VILLAGE_STAGE_NAMES,
  VILLAGE_STAGE_BG,
  type TownTarget,
} from './three/TownScene';
import { ALL_UPGRADES, BASE_STATS, draftThree, pickUpgrades, type Stats, type Upgrade } from './lib/upgrades';
import { makeQuiz, MAX_DOOR_ROUND, type DungeonMode } from './lib/quiz';
import { metaSpeed, shopCost, type Meta } from './lib/meta';
import { todayKey, dailySeed, type DailyRecord } from './lib/daily';
import { EMPTY_DEX, DEX_MILESTONES, dexPct, type DexState } from './lib/dex';
import DexScreen from './ui/DexScreen';
import { mulberry32 } from './lib/rng';
import { useLocalStorage, suspendPersistence } from './lib/store';
import { sfx, isMuted, setMuted } from './lib/sound';
import { music } from './lib/music';
import { shareCard } from './lib/shareCard';
import {
  MEMORIES,
  migrateCount,
  newlyCompletedSet,
  nextMemory,
  powersOf,
  type MemorySetId,
} from './lib/memories';
import {
  STORY_NODES,
  girlScript,
  getDeathLore,
  chiefTalk,
  ninaTalk,
  mukTalk,
  peddlerTalk,
  entranceOptions,
  type TownContext,
  type TownLine,
  type TownNode,
  type TownOption,
} from './lib/story';
import { initAutoRotate, type AppRotation } from './lib/rotate';
import { useDemoDriver } from './demo/useDemoDriver';
import { GameHud, ArenaHud, VillageHud, BuildRow, BossBar } from './ui/Hud';
import MiniMap, { makeMiniMapChannel } from './ui/MiniMap';
import TitleScreen from './ui/TitleScreen';
import StoryScreen from './ui/StoryScreen';
import TownDialogScreen from './ui/TownDialogScreen';
import VillageOverlay, { type VillageTalk } from './ui/VillageOverlay';
import ShopScreen from './ui/ShopScreen';
import { PortalScreen, HomeDoorScreen, AltarScreen, SecretDoorScreen, RiftScreen } from './ui/FloorPrompts';
import { QuizResultScreen, ArenaOverScreen, type QuizView } from './ui/ChestScreens';
import {
  LoreScreen,
  TraceScreen,
  MemoryScreen,
  MemorySetScreen,
  MemFullScreen,
} from './ui/LoreScreens';
import DraftScreen from './ui/DraftScreen';
import OverScreen from './ui/OverScreen';
import EndingScreen, { type EndingVariant } from './ui/EndingScreen';
import DebugPanel from './ui/DebugPanel';
import { DemoCaption, DemoExitButton, DemoEndScreen } from './ui/DemoOverlay';

// 흐름: title → story(인트로) → village(마을) → run
//  - 보물상자(수학 모드): run → doorrun(두 문 달리기, 최대 3연속) → quiz(결과) → memory(되찾은 기억) → run
//  - 보물상자(몬스터 모드): run → arena(무리 처치+보석 3개) → quiz(보상) / arenaover(쓰러짐 → 재도전·포기) → memory → run
//  - 층 이동: run → portal(내려갈지 선택) → draft(보상 3택 1) → lore(벽의 글귀) → run(다음 층)
//  - 5층마다: run → homedoor(마을 문 선택) → village(방문 — 층 유지) → run
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
  | 'memset' // 기억 갈래 완성 — 특별한 능력 각성
  | 'memfull'
  | 'portal'
  | 'draft'
  | 'lore'
  | 'homedoor'
  | 'altar'
  | 'secretdoor'
  | 'rift' // 두 갈래 틈 — 층 안 순간이동 지름길
  | 'shop'
  | 'dex' // 도감 「채워지는 책」 (타이틀에서 열람)
  | 'trace'
  | 'ending'
  | 'over';

// 시연 '다시 보기'는 리로드 후 자동 재생 — 리로드 너머로 의도를 실어 나르는 세션 키
const DEMO_AUTO_KEY = 'd100-demo-auto';

// 모바일 진동 — 지원 기기에서만 (피격·처치·보물 짧은 햅틱)
const buzz = (ms: number) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(ms);
};

// 그래픽 품질 기본값 — 모바일은 ⚡가벼움(포스트프로세싱이 비싸다), 데스크톱은 ✨고품질
const defaultGfx = (): 'high' | 'lite' =>
  typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)
    ? 'lite'
    : 'high';

export default function App() {
  const [phase, setPhase] = useState<Phase>('title');
  const [floorNo, setFloorNo] = useState(1);
  // 잉크 전환 — 층 이동·사망·마을 진입 때 잉크가 번졌다 걷히는 연출 (seq가 바뀌면 재생)
  const [inkSeq, setInkSeq] = useState(0);
  const inkSkipFirst = useRef(true);
  useEffect(() => {
    if (inkSkipFirst.current) {
      inkSkipFirst.current = false;
      return;
    }
    setInkSeq((s) => s + 1);
  }, [floorNo]);
  useEffect(() => {
    if (phase === 'village' || phase === 'over') setInkSeq((s) => s + 1);
  }, [phase]);
  // 처치 콤보 — 3초 창 안의 연속 처치를 세고, 끊기면 칩을 숨긴다
  const comboRef = useRef({ n: 0, until: 0 });
  const [combo, setCombo] = useState({ n: 0, mult: 1, seq: 0 });
  useEffect(() => {
    if (combo.n < 2) return;
    const id = setTimeout(() => {
      if (performance.now() >= comboRef.current.until) setCombo({ n: 0, mult: 1, seq: 0 });
    }, 3100);
    return () => clearTimeout(id);
  }, [combo.seq, combo.n]);
  // 미니맵 채널 — DungeonScene이 채우고 MiniMap(DOM 캔버스)이 읽는다
  const minimapRef = useRef(makeMiniMapChannel());
  // 강제 가로 모드 — 시스템 회전 잠금 상태에서 기기를 눕히면 UI를 통째로 90° 회전
  // (기울기 센서 감지는 src/lib/rotate.ts, 실제 회전은 .app의 force-cw/ccw CSS)
  const [forceRot, setForceRot] = useState<AppRotation>(0);
  useEffect(() => initAutoRotate(setForceRot), []);
  // 낮은 화면 압축(.low-h) — 진짜 낮은 뷰포트(폰 가로)든 강제 회전으로 시각 높이가
  // 뷰포트 '너비'가 된 경우든, 오버레이 압축 스타일을 한 클래스로 통일해서 적용
  useEffect(() => {
    const mq = window.matchMedia('(max-height: 520px)');
    const sync = () =>
      document.documentElement.classList.toggle(
        'low-h',
        mq.matches || (forceRot !== 0 && window.innerWidth <= 520),
      );
    sync();
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [forceRot]);
  // 부활 체크포인트 — 마지막으로 다녀온 5층 단위 마을 층 (죽으면 여기서 다시 시작)
  const [checkpointFloor, setCheckpointFloor] = useState(1);
  const [stats, setStats] = useState<Stats>(BASE_STATS);
  const [hp, setHp] = useState(BASE_STATS.maxHp);
  const [kills, setKills] = useState(0);
  const [runId, setRunId] = useState(0);
  const [best, setBest] = useLocalStorage<number>('d100-best', 0);
  const [storySeen, setStorySeen] = useLocalStorage<boolean>('d100-story', false);
  // 되찾은 기억 — 예전엔 개수만(d100-mem) 저장했는데, 갈래별 능력이 생기면서
  // '어떤 기억을 모았는지'가 필요해졌다. 옛 세이브는 개수만큼 앞에서부터 채워 이어받는다.
  const [oldMemCount] = useLocalStorage<number>('d100-mem', 0);
  const [memIds, setMemIds] = useLocalStorage<string[]>('d100-mems', migrateCount(oldMemCount));
  const memCount = memIds.length;
  const powers = useMemo(() => powersOf(memIds), [memIds]);
  const [setUnlocked, setSetUnlocked] = useState<MemorySetId | null>(null);
  const reviveUsedRef = useRef(false); // '돌아갈 곳' — 판당 1회
  const [reviveNotice, setReviveNotice] = useState(0);
  const [coins, setCoins] = useLocalStorage<number>('d100-coins', 0);
  const [meta, setMeta] = useLocalStorage<Meta>('d100-meta', { dmg: 0, hp: 0, spd: 0 });
  const [deaths, setDeaths] = useLocalStorage<number>('d100-deaths', 0);
  const [girlMet, setGirlMet] = useLocalStorage<boolean>('d100-girl', false);
  // 떠돌이 상인 🎩 — 첫 만남(원본 독백 + 덤) 여부. 마을 방문 중에만 광장에 와 있다
  const [peddlerMet, setPeddlerMet] = useLocalStorage<boolean>('d100-peddler', false);
  // ── 도감 「채워지는 책」 — 만난 것들이 페이지로 기록된다 (수집률 마일스톤 = 1회성 코인)
  const [dex, setDex] = useLocalStorage<DexState>('d100-dex', EMPTY_DEX);
  const [dexClaimed, setDexClaimed] = useLocalStorage<number>('d100-dex-claim', 0);
  const dexAdd = useCallback((kind: keyof DexState, id: string) => {
    setDex((d) => (d[kind].includes(id) ? d : { ...d, [kind]: [...d[kind], id] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const pct = dexPct(dex);
    let claim = dexClaimed;
    let gain = 0;
    while (claim < DEX_MILESTONES.length && pct >= DEX_MILESTONES[claim].pct) {
      gain += DEX_MILESTONES[claim].coins;
      claim++;
    }
    if (gain > 0) {
      setDexClaimed(claim);
      setCoins((c) => c + gain);
      sfx.gift();
      setGoldFlash((f) => f + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dex]);

  // 그래픽 품질 — ⚡가벼움(기존 렌더 경로: 포스트프로세싱 없음·DPR 캡·플랫 재질) / ✨고품질.
  // 기본은 'auto': 실플레이 FPS를 재서 스스로 결정(아래 측정 effect), 결정은 d100-gfx-auto에 저장.
  // 토글을 누르면 그때부터 수동 설정(auto 해제).
  const [gfxPref, setGfxPref] = useLocalStorage<'auto' | 'high' | 'lite'>('d100-gfx', 'auto');
  const [gfxAuto, setGfxAuto] = useLocalStorage<'high' | 'lite' | null>('d100-gfx-auto', null);
  const gfx: 'high' | 'lite' = gfxPref === 'auto' ? (gfxAuto ?? defaultGfx()) : gfxPref;
  const lite = gfx === 'lite';
  const [gfxNotice, setGfxNotice] = useState(0); // 자동 강등 안내 배너
  const toggleGfx = () => {
    sfx.tap();
    setGfxPref(lite ? 'high' : 'lite');
  };

  // 자동 품질 측정 — 수동 설정이 없고 고품질로 도는 중이면, run 워밍업 2초 후 3초 창의
  // 평균 FPS로 판정: 45 미만 → ⚡가벼움 강등(배너 안내) / 55 이상 → ✨고품질 확정.
  // 결정은 저장되어 다음 세션부터 측정 없이 바로 적용된다. (모바일 기본 lite는 측정 없이 유지)
  useEffect(() => {
    if (gfxPref !== 'auto' || gfxAuto !== null || phase !== 'run' || lite) return;
    let raf = 0;
    let last = performance.now();
    let winStart = 0;
    let frames = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (dt > 250) {
        // 숨김 탭·일시정지 — 측정 창 리셋
        winStart = 0;
        frames = 0;
      } else if (winStart === 0) {
        winStart = now;
      } else if (now - winStart > 2000) {
        frames++;
        const measured = now - winStart - 2000;
        if (measured > 3000) {
          const fps = (frames / measured) * 1000;
          if (fps < 45) {
            setGfxAuto('lite');
            setGfxNotice((n) => n + 1);
            return; // 종료 (강등)
          }
          if (fps >= 55) {
            setGfxAuto('high');
            return; // 종료 (확정)
          }
          winStart = 0; // 애매한 구간 — 다시 측정
          frames = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gfxPref, gfxAuto, phase, lite]);
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
  const [villageTalk, setVillageTalk] = useState<VillageTalk | null>(null);
  const [mode, setMode] = useState<DungeonMode>('kids');
  // 일일 던전 — 오늘 날짜 = 시드, 모두가 같은 맵 (어른 문제 고정, 기록은 d100-daily)
  const [runType, setRunType] = useState<'normal' | 'daily'>('normal');
  const [dailyBest, setDailyBest] = useLocalStorage<DailyRecord | null>('d100-daily', null);
  const dailyNum = useMemo(() => dailySeed(todayKey()), []);
  const [muted, setMutedState] = useState(isMuted());
  const [bossHp, setBossHp] = useState(0);
  const [bossMax, setBossMax] = useState(0);
  const [storyAnswer, setStoryAnswer] = useState<'ok' | 'no' | null>(null);
  const [memRewards, setMemRewards] = useState<Upgrade[]>([]);
  const [endingVariant, setEndingVariant] = useState<EndingVariant>(null);
  const [endingIdx, setEndingIdx] = useState(0);

  // 디버그 (Shift+D): 개발 모드 또는 ?debug 쿼리에서만 (일반 방문자 오작동 방지)
  const debugAllowed = useMemo(
    () => import.meta.env.DEV || new URLSearchParams(location.search).has('debug'),
    [],
  );
  const [debugOpen, setDebugOpen] = useState(false);

  // 자동 시연 — 타이틀에서 언제든 볼 수 있는 상시 쇼케이스 (2026-07-19 ?demo 게이트 해제).
  // 이 시연이 최신 콘텐츠를 계속 보여 주는 상시 쇼케이스다.
  // **세이브 격리**: 시연은 실제 게임을 그대로 플레이하므로 시작 시 저장을 끄고(suspendPersistence),
  // 나가는 모든 경로(종료 버튼·다시 보기·직접 플레이)를 리로드로 통일한다 —
  // 시연이 만든 진행(코인·기억·최고 층·일일 기록)이 세이브에도, 화면에도 남지 않는다.
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
  // 💓 '두근거림' — 체력 30% 미만이면 공격력 배율이 오른다 (씬이 매 프레임 참조)
  const damageMulRef = useRef(1);
  damageMulRef.current =
    powers.desperateMul > 1 && hp > 0 && hp < stats.maxHp * 0.3 ? powers.desperateMul : 1;
  const portalRetryRef = useRef(0);
  const homeRetryRef = useRef(0);
  const homeUsedRef = useRef(0);
  // 방 이벤트 — 제단·찢어진 페이지 (거절 시 재무장, 제단은 바치면 소멸)
  const altarRetryRef = useRef(0);
  const altarUsedRef = useRef(0);
  const secretRetryRef = useRef(0);
  // 두 갈래 틈 — 거절 시 재무장 / 수락 시 반대편으로 순간이동 (씬이 처리)
  const riftRetryRef = useRef(0);
  const riftGoRef = useRef(0);
  // 진화 「합본」 획득 순간 — 씬 대형 연출 트리거 (금-장미 폭발 + 잔광 + 셰이크)
  const evoFxRef = useRef(0);
  const [altarReward, setAltarReward] = useState<Upgrade | null>(null);
  const visitGiftGiven = useRef<Set<number>>(new Set()); // 방문당 노드별 선물 1회

  // 일일 던전 기록 갱신 (사망·완주 공용)
  const recordDaily = (floor: number, cleared = false) => {
    if (runType !== 'daily') return;
    const key = todayKey();
    if (!dailyBest || dailyBest.date !== key || floor > dailyBest.floor) {
      setDailyBest({ date: key, floor, cleared });
    } else if (cleared && !dailyBest.cleared) {
      setDailyBest({ ...dailyBest, cleared: true });
    }
  };

  // 사망 판정은 hp 변화에 반응 (이벤트 콜백을 안정적으로 유지하기 위함)
  useEffect(() => {
    if (phase === 'run' && hp <= 0) {
      // 🏠 '돌아갈 곳' — 집의 기억을 다 모았으면 판당 1회 다시 일어난다
      if (powers.revive && !reviveUsedRef.current) {
        reviveUsedRef.current = true;
        setHp(Math.max(1, Math.round(stats.maxHp * 0.4)));
        setGoldFlash((f) => f + 1);
        setReviveNotice((n) => n + 1);
        sfx.legend();
        return;
      }
      setPhase('over');
      if (floorNo > best) setBest(floorNo);
      recordDaily(floorNo);
      setOverLore(getDeathLore(deaths)); // 죽을수록 위화감이 커진다
      setDeaths(deaths + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hp, phase]);

  // 일일 던전은 재도전해도 같은 드래프트·같은 문제가 나오게 runId 대신 날짜 시드를 쓴다
  const runVar = runType === 'daily' ? dailyNum % 100000 : runId;

  // ── 갈림길 「모험의 길」 — 층 시드 35%로 포털에 위험 선택지가 열린다 (StS식 경로 선택).
  //    수락하면 다음 층이 사나워지고(스폰↑·피해↑), 그 층 돌파 드래프트는 전부 레어 이상.
  const [dangerFloor, setDangerFloor] = useState(0); // 위험 계약이 걸린 층 (0 = 없음)
  const branchOpen = useMemo(
    () =>
      floorNo >= 3 &&
      (floorNo + 1) % 10 !== 0 && // 다음 층이 보스면 안 연다 (보스전은 이미 위험)
      mulberry32(runVar * 613 + floorNo * 977 + 41)() < 0.35,
    [runVar, floorNo],
  );

  // 드래프트 — 희귀도 가중 + 태그 시너지(같은 태그 2개+ 보유 시 그 태그가 더 잘 나온다).
  // 위험 층(dangerFloor)을 돌파하는 드래프트는 전부 레어 이상 (모험의 보상)
  const draft = useMemo(
    () => draftThree(mulberry32(runVar * 7919 + floorNo * 131 + 7), build, dangerFloor === floorNo),
    [runVar, floorNo, build, dangerFloor],
  );

  // 문(라운드)마다 새 문제 — 깊은 라운드일수록 어려운 문제 등급, 던전 종류에 따라 수준 조절
  const quizSeed = runVar * 104729 + floorNo * 131 + quizSeq * 17 + doorRound * 7 + 5;
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
    else if (phase === 'altar') sfx.lore();
    else if (phase === 'secretdoor') sfx.portal();
    else if (phase === 'rift') sfx.lore();
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
      recordDaily(100, true);
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
      mode: (m: DungeonMode) => setMode(m), // 주인공 변신 검증용 (kids/adult/monster)
      give: (id: string) => {
        // 업그레이드 강제 지급 — 진화 조합 검증용 (DEV 전용)
        const u = ALL_UPGRADES.find((x) => x.id === id);
        if (u) gainUpgrade(u);
        return u ? u.name : 'unknown id';
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // 다음에 돌아올 기억 (순서대로 — 다 모았으면 마지막 것을 다시 보여 준다)
  const memory = nextMemory(memIds) ?? MEMORIES[MEMORIES.length - 1];

  // type 미지정: 모드를 골랐으면 보통 런, 무인자(게임오버 재도전)는 현재 런 유형 유지
  const enterDungeon = (m?: DungeonMode, type?: 'normal' | 'daily') => {
    const rt = type ?? (m ? 'normal' : runType);
    setRunType(rt);
    const startMode = rt === 'daily' ? 'adult' : m; // 일일 던전은 어른 문제 고정 (공정 비교)
    if (startMode) setMode(startMode);
    sfx.enter();
    setStorySeen(true);
    setFloorNo(1);
    setCheckpointFloor(1); // 새 도전 — 체크포인트 초기화
    setDangerFloor(0); // 위험 계약 초기화
    reviveUsedRef.current = false; // '돌아갈 곳'은 판마다 다시 채워진다
    // 대장간 영구 강화 + 기억 완성 보너스 반영
    const startStats: Stats = {
      ...BASE_STATS,
      damage: BASE_STATS.damage + meta.dmg * 2,
      maxHp: BASE_STATS.maxHp + meta.hp * 15 + powers.bonusMaxHp,
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

  // ── 자동 시연 (세이브 격리) — 시작 시 저장을 끄고, 나갈 때는 리로드로 원래 세이브 복귀
  const startDemo = () => {
    suspendPersistence(true);
    sfx.enter();
    setDemoDone(false);
    setDemoRunning(true);
  };
  // 다시 보기도 리로드로 — 시연이 남긴 화면 상태 없이 처음부터 재생된다
  const replayDemo = () => {
    sfx.tap();
    sessionStorage.setItem(DEMO_AUTO_KEY, '1');
    location.href = location.pathname;
  };
  // 리로드 직후 자동 재생 (다시 보기 경로)
  useEffect(() => {
    if (sessionStorage.getItem(DEMO_AUTO_KEY)) {
      sessionStorage.removeItem(DEMO_AUTO_KEY);
      startDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    peddlerBoughtRef.current.clear(); // 상인 매대는 마을 들를 때마다 새로
    peddlerWaresRef.current = [];
    setPhase('village');
  };
  const onVillageNear = useCallback((t: TownTarget) => setVillageNear(t), []);

  // ── 떠돌이 상인 매대 — 코인으로 이번 판 아이템을 산다 (대장간=영구, 상인=즉석 화력)
  //    물건은 (runId, 층) 시드로 3개 — 같은 방문 동안 재고 고정, 산 것은 '팔림'.
  const peddlerBoughtRef = useRef<Set<number>>(new Set());
  const peddlerWaresRef = useRef<Upgrade[]>([]);
  const peddlerCost = (u: Upgrade) => (u.rarity === 'legendary' ? 120 : u.rarity === 'rare' ? 70 : 40);
  const makePeddlerWaresNode = (coinsNow: number): TownNode => {
    // 방문당 1회만 뽑아 고정 — 구매로 build가 바뀌어도 매대가 흔들리지 않게
    if (peddlerWaresRef.current.length === 0)
      peddlerWaresRef.current = pickUpgrades(mulberry32(runId * 97 + floorNo * 31 + 5), 3, build);
    const wares = peddlerWaresRef.current;
    return {
      kind: 'choice',
      prompt: `상인이 바퀴 없는 마차를 열어 보였다. (가진 코인 🪙${coinsNow})`,
      options: [
        ...wares.map((u, i) => {
          const cost = peddlerCost(u);
          const sold = peddlerBoughtRef.current.has(i);
          return {
            label: sold ? `${u.icon} ${u.name} — 팔림` : `${u.icon} ${u.name} — 🪙${cost}`,
            action: 'buy' as const,
            buySlot: i,
            disabled: sold || coinsNow < cost,
          };
        }),
        { label: '👋 구경만 할게요', action: 'close' as const },
      ],
    };
  };

  // 마을에서 NPC/입구에 다가가 상호작용 버튼을 누르면 그에 맞는 대화 스크립트를 연다
  const talkTo = (target: TownTarget) => {
    if (!target) return;
    sfx.tap();
    let script: TownNode[] = [];
    // 시절 연동 대사는 villageFloor 기준 (enter 허브는 0 = 평화로운 시절)
    if (target === 'chief') script = chiefTalk(villageCtx, villageFirst, villageFloor);
    else if (target === 'nina') script = ninaTalk(villageCtx, villageFloor);
    else if (target === 'muk') script = mukTalk(villageFloor);
    else if (target === 'peddler') {
      // 대사(첫 만남은 원본 독백 + 덤) 뒤에 매대가 붙는다 — 마지막 대사의 next = 매대 인덱스
      script = [...peddlerTalk(peddlerMet, villageFloor), makePeddlerWaresNode(coins)];
      if (!peddlerMet) setPeddlerMet(true);
      dexAdd('events', 'peddler');
    } else if (target === 'entrance') script = entranceOptions(villageCtx, floorNo);
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
      const u = pickUpgrades(mulberry32(runId * 41 + floorNo * 13 + 7), 1, build)[0];
      gainUpgrade(u);
      setGiftName(`${u.icon} ${u.name} 획득`);
      setGoldFlash((f) => f + 1);
      sfx.gift();
    }
  };

  const closeTalk = () => setVillageTalk(null);

  // 대화 진행 — line은 next(<0이면 종료), choice는 action 처리
  const advanceTalkLine = (node: TownLine) => {
    sfx.tap();
    if (node.next < 0 || !villageTalk || node.next >= villageTalk.script.length) {
      closeTalk();
      return;
    }
    const nextNode = villageTalk.script[node.next];
    applyVillageGift(nextNode);
    setVillageTalk({ script: villageTalk.script, idx: node.next });
  };
  const chooseTalkOption = (o: TownOption) => {
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
    } else if (o.action === 'buy') {
      // 떠돌이 상인 구매 — 코인 차감 + 즉시 장착, 남은 재고로 매대 갱신
      const u = peddlerWaresRef.current[o.buySlot ?? -1];
      if (!u) {
        closeTalk();
        return;
      }
      const cost = peddlerCost(u);
      if (coins < cost || peddlerBoughtRef.current.has(o.buySlot!)) {
        sfx.tap();
        return;
      }
      peddlerBoughtRef.current.add(o.buySlot!);
      setCoins((c) => c - cost);
      gainUpgrade(u);
      setGoldFlash((f) => f + 1);
      sfx.gift();
      const thanks: TownNode = {
        kind: 'line',
        icon: '🎩',
        speaker: '떠돌이 상인',
        text: `좋은 눈이야. (${u.icon} ${u.name} 획득)`,
        next: 1,
      };
      setVillageTalk({ script: [thanks, makePeddlerWaresNode(coins - cost)], idx: 0 });
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

  // 인트로 진행 — 마지막 장이면 마을로
  const advanceStory = () => {
    sfx.tap();
    setStoryAnswer(null);
    if (storyIdx >= STORY_NODES.length - 1) goVillage('enter', true);
    else setStoryIdx((i) => i + 1);
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

  // 별도 DOM 마을 화면('town')의 선택지 처리
  const chooseTownOption = (o: TownOption) => {
    sfx.tap();
    if (o.action === 'enter') enterDungeon(o.mode);
    else if (o.action === 'return') setPhase('run');
    else if (o.action === 'shop') setPhase('shop');
    else setTownIdx(o.next ?? townIdx);
  };

  const gainUpgrade = (u: Upgrade) => {
    setStats((s) => u.apply(s));
    if (u.id === 'hp') setHp((h) => h + 25);
    setBuild((b) => ({ ...b, [u.id]: (b[u.id] ?? 0) + 1 }));
    dexAdd('items', u.id); // 도감 — 얻어 본 보물 기록 (진화 포함)
  };

  // 통과한 문 수(tier)만큼 보물 지급 — 3문 완주는 전설 보물(전부 + 완전 회복)
  const grantRewards = (tier: number, seed = quizSeed + 991) => {
    const picks = pickUpgrades(mulberry32(seed), tier, build);
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
    picks.forEach((u) => dexAdd('items', u.id)); // 도감 — 보물 경로도 기록
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
      const u = pickUpgrades(mulberry32(runId * 31 + floorNo * 7 + townIdx * 5 + 11), 1, build)[0];
      gainUpgrade(u);
      setGiftName(`${u.icon} ${u.name} 획득`);
    }
    setGoldFlash((f) => f + 1);
    sfx.gift();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, townMode, townNode]);

  // 보물 획득 햅틱 — 황금 잔광(goldFlash)이 오르는 모든 지급 경로 공통
  useEffect(() => {
    if (goldFlash > 0) buzz(40);
  }, [goldFlash]);

  const onDamage = useCallback((dmg: number) => {
    sfx.hurt();
    buzz(30); // 모바일 진동 — 피격
    setFlash((f) => f + 1);
    setHp((h) => Math.max(0, h - dmg));
  }, []);
  // 흡혈의 잉크 — 처치 시 회복 (씬이 호출)
  const onHeal = useCallback((amount: number) => {
    setHp((h) => Math.min(statsRef.current.maxHp, h + amount));
  }, []);
  const onKill = useCallback(
    (bounty: number, kind?: string) => {
      sfx.kill();
      buzz(12); // 모바일 진동 — 처치
      setKills((k) => k + 1);
      if (kind) dexAdd('mobs', kind); // 도감 — 처치한 몬스터 종류 기록
      // 처치 콤보 — 3초 안에 이어서 처치하면 코인 배율 (4연속 ×2, 8연속 ×3)
      const now = performance.now();
      const cb = comboRef.current;
      cb.n = now < cb.until ? cb.n + 1 : 1;
      cb.until = now + 3000;
      const mult = cb.n >= 8 ? 3 : cb.n >= 4 ? 2 : 1;
      if (cb.n >= 2) setCombo((v) => ({ n: cb.n, mult, seq: v.seq + 1 }));
      // 탐욕의 책갈피 — 코인 배율 (콤보 배율과 곱연산 = 시너지)
      setCoins((c) => c + Math.max(1, Math.round(bounty * statsRef.current.greed * mult)));
      // 진화 「인세」 — 코인이 들어올 때마다 회복
      if (statsRef.current.royalty > 0) setHp((h) => Math.min(statsRef.current.maxHp, h + 2));
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
    dexAdd('mobs', 'boss'); // 도감 — 페이지의 수호자
    const pick = pickUpgrades(mulberry32(quizSeedRef.current + 777), 1)[0];
    dexAdd('items', pick.id);
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
  const startArena = () => {
    setArenaGems(0);
    setArenaHp(ARENA_MAX_HP);
    setArenaMax(ARENA_MAX_HP);
    setArenaTry((t) => t + 1);
    setPhase('arena');
  };
  const startArenaRef = useRef(startArena);
  startArenaRef.current = startArena;
  const onChest = useCallback(() => {
    if (modeRef.current === 'monster') {
      // 몬스터 모드 — 보물상자는 몬스터 아레나를 연다
      startArenaRef.current();
    } else {
      setDoorRound(1);
      setPhase('doorrun');
    }
  }, []);
  const onHomeDoor = useCallback(() => {
    dexAdd('events', 'homedoor');
    setPhase('homedoor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 제단·찢어진 페이지 접촉 → 선택 화면 (도감에도 기록)
  const onAltar = useCallback(() => {
    dexAdd('events', 'altar');
    setAltarReward(null);
    setPhase('altar');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onSecret = useCallback(() => {
    dexAdd('events', 'secret');
    setPhase('secretdoor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onRift = useCallback(() => {
    dexAdd('events', 'rift');
    setPhase('rift');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 몬스터 하우스 코인 무더기 (탐욕 배율 적용)
  const onCoins = useCallback(
    (n: number) => {
      sfx.treasure();
      dexAdd('events', 'house'); // 코인 무더기 = 몬스터 하우스에 들어왔다는 뜻
      setCoins((c) => c + Math.max(1, Math.round(n * statsRef.current.greed)));
      // 진화 「인세」 — 코인 무더기에도 적용
      if (statsRef.current.royalty > 0) setHp((h) => Math.min(statsRef.current.maxHp, h + 2));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const onTrace = useCallback(() => {
    sfx.memory();
    dexAdd('events', 'trace');
    const fl = floorNoRef.current;
    setTracesSeen((prev) => (prev.includes(fl) ? prev : [...prev, fl]));
    setPhase('trace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onGirl = useCallback(() => {
    sfx.gift();
    dexAdd('events', 'girl');
    setGirlMet(true);
    goTown(girlScript(tracesSeenRef.current.includes(42)), 'girl', {
      sky: '✨',
      scape: '🕯️ 🫖 📚 🌼 🕯️',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickUpgrade = (u: Upgrade) => {
    if (dangerFloor === floorNo) setDangerFloor(0); // 위험 계약 층을 떠난다 — 계약 종료
    if (u.evo) {
      // 진화 「합본」 — 잿팟 연출 (전설음 + 황금 잔광 + 햅틱 + 씬 대형 폭발)
      sfx.legend();
      sfx.unlock();
      setGoldFlash((f) => f + 1);
      buzz(60);
      evoFxRef.current += 1;
    } else {
      sfx.pick();
    }
    gainUpgrade(u);
    setFloorNo((n) => n + 1);
    // ☕ '사소한 것들의 힘' — 새 층에 도착할 때마다 조금씩 회복된다
    if (powers.floorHeal > 0) {
      setHp((h) => Math.min(statsRef.current.maxHp, h + powers.floorHeal));
    }
    setPhase('lore'); // 새 층에 도착하면 벽의 글귀부터
  };

  // 두 문 달리기 결과 — 오답이면 그동안의 문도 전부 물거품 (빈손)
  // 단 🎓 '벼락치기'를 얻었다면 틀려도 아이템 1개는 건진다.
  const onDoorRunDone = (ok: boolean) => {
    if (!ok) {
      if (powers.consolation) {
        grantRewards(1);
        setQuizView('ok');
        setPhase('quiz');
        return;
      }
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
    startArena();
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
    // 보물 = 기억 하나가 돌아온다. 이미 전부 되찾았다면 회상 화면은 건너뛴다.
    const allFound = memIds.length >= MEMORIES.length;
    setPhase(gotReward && !allFound ? 'memory' : 'run');
  };

  const closeMemory = () => {
    sfx.tap();
    if (!memory) {
      setPhase('run');
      return;
    }
    const before = memIds;
    const after = before.includes(memory.id) ? before : [...before, memory.id];
    setMemIds(after);
    // 갈래 하나를 다 모았다면 — 특별한 능력이 깨어난다
    const unlocked = newlyCompletedSet(before, after);
    if (unlocked) {
      setSetUnlocked(unlocked);
      setGoldFlash((f) => f + 1);
      sfx.legend();
      setPhase('memset');
      return;
    }
    // 완성 보상은 '마지막 조각을 채운 그 순간'에만 (이미 다 모은 뒤 반복 지급 방지)
    if (before.length < MEMORIES.length && after.length === MEMORIES.length) {
      const picks = pickUpgrades(mulberry32(runId * 53 + 12), 2, build);
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

  // 갈래 완성 화면을 닫으면 — 전부 모았을 때만 완성 보상으로, 아니면 던전 복귀
  const closeMemSet = () => {
    sfx.tap();
    setSetUnlocked(null);
    if (memIds.length >= MEMORIES.length) {
      const picks = pickUpgrades(mulberry32(runId * 53 + 12), 2, build);
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

  // ── 제단: 체력 30%를 바치고 보물 하나 (수락 시 제단 소멸, 거절 시 벗어나면 재무장)
  const altarCost = Math.ceil(stats.maxHp * 0.3);
  const offerAltar = () => {
    const pick = pickUpgrades(mulberry32(runVar * 977 + floorNo * 31 + 3), 1, build)[0];
    setHp((h) => Math.max(1, h - altarCost));
    gainUpgrade(pick);
    setAltarReward(pick);
    altarUsedRef.current += 1;
    setGoldFlash((f) => f + 1);
    sfx.hurt();
    sfx.treasure();
  };
  const declineAltar = () => {
    sfx.tap();
    altarRetryRef.current += 1;
    setPhase('run');
  };

  // ── 찢어진 페이지: 2개 층을 건너뛴다 (착지 충격 — 건너뛴 층의 보상도 없다)
  const jumpSecret = () => {
    sfx.portal();
    setFloorNo((n) => Math.min(100, n + 2));
    setHp((h) => Math.max(1, h - Math.round(stats.maxHp * 0.08))); // 착지 충격
    setPhase('lore'); // 새 층 도착 — 벽의 글귀부터 (드래프트 없음 = 건너뛴 대가)
  };
  const declineSecret = () => {
    sfx.tap();
    secretRetryRef.current += 1;
    setPhase('run');
  };
  // 두 갈래 틈 — 들어가면 씬이 반대편으로 순간이동시킨다 (연출·자비 포함)
  const enterRift = () => {
    riftGoRef.current += 1;
    setPhase('run');
  };
  const declineRift = () => {
    sfx.tap();
    riftRetryRef.current += 1;
    setPhase('run');
  };

  // 죽으면 1층이 아니라 마지막으로 다녀온 마을(체크포인트)에서 부활 — 장비 유지·완전 회복.
  // 주민들이 맞아 주고, 거기서 다시 던전으로 내려간다. ('죽음=다시 쓰임' 세계관과 연결)
  const resumeFromCheckpoint = () => {
    sfx.tap();
    setFloorNo(checkpointFloor);
    setHp(stats.maxHp); // 부활 — 완전 회복 (스탯·빌드는 유지)
    setDangerFloor(0); // 죽었으면 위험 계약도 사라진다
    setDoorRound(1);
    quizResultRef.current = null;
    setRunId((id) => id + 1); // 씬 강제 리마운트 (같은 층에서 죽어도 새로 시작)
    goVillage('death');
  };

  // 자동 시연 드라이버 — 시나리오는 src/demo/useDemoDriver.ts, 여기선 조작 프리미티브만 제공
  useDemoDriver(demoRunning, {
    caption: setDemoCaption,
    phase: () => phaseRef.current,
    village: (ctx) => goVillage(ctx),
    chiefTalk: () => setVillageTalk({ script: chiefTalk('enter', true, 0), idx: 0 }),
    dungeon: () => enterDungeon('kids'),
    treasure: () => debugGrantRef.current(),
    doorrun: () => {
      setDoorRound(1);
      setPhase('doorrun');
    },
    arena: startArena,
    jump: debugJump,
    evolve: () => {
      // 진화 시연 — 조합(멀티샷×2+연사×2)을 채우고 드래프트를 바로 연다 → 「쏟아지는 문장」 확정 등장
      const multi = ALL_UPGRADES.find((u) => u.id === 'multi')!;
      const rate = ALL_UPGRADES.find((u) => u.id === 'rate')!;
      gainUpgrade(multi);
      gainUpgrade(multi);
      gainUpgrade(rate);
      gainUpgrade(rate);
      setPhase('draft');
    },
    nav: () => {
      // 시연 길찾기용 — 미니맵 채널(프로덕션 포함)의 그리드·좌표 스냅샷
      const ch = minimapRef.current;
      return ch.cells
        ? { cells: ch.cells, px: ch.px, py: ch.py, exitX: ch.exitX, exitY: ch.exitY }
        : null;
    },
    altar: () => {
      setAltarReward(null);
      setPhase('altar');
    },
    secretDoor: () => setPhase('secretdoor'),
    setFloor: setFloorNo,
    girlTea: () => {
      sfx.gift();
      goTown(girlScript(false), 'girl', { sky: '✨', scape: '🕯️ 🫖 📚 🌼 🕯️' });
    },
    finish: () => {
      setPhase('title');
      setDemoCaption('');
      setDemoRunning(false);
      setDemoDone(true);
    },
  });

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

  const inGame = !(
    phase === 'title' ||
    phase === 'story' ||
    phase === 'shop' ||
    phase === 'dex' ||
    (phase === 'town' && townMode === 'pre')
  );
  const inDungeonUi =
    inGame &&
    phase !== 'town' &&
    phase !== 'village' &&
    phase !== 'arena' &&
    phase !== 'arenaover';

  return (
    <div className={`app${forceRot === 90 ? ' force-cw' : forceRot === -90 ? ' force-ccw' : ''}`}>
      {/* 잉크 전환 — key가 바뀔 때마다 애니메이션 재생 (pointer-events 없음, 조작 안 막음) */}
      {inkSeq > 0 && <div className="ink-wipe" key={inkSeq} />}

      {/* 자동 품질 강등 안내 (FPS 측정 결과 ⚡가벼움으로 전환됨) */}
      {gfxNotice > 0 && (
        <div className="gfx-notice" key={gfxNotice}>
          ⚡ 성능을 위해 그래픽을 '가벼움'으로 조절했어요 — HUD의 ⚡ 버튼으로 되돌릴 수 있어요
        </div>
      )}
      {inGame && (
        <Canvas
          className="canvas"
          camera={{ fov: 50, position: [0, 15.5, 9.5] }}
          dpr={lite ? [1, 1.5] : [1, 2]}
          // offsetSize: 강제 가로 회전(.force-cw/ccw) 시 getBoundingClientRect는 회전된
          // bbox(세로)를 돌려줘 캔버스가 잘못 재진다 — 레이아웃 크기(offsetWidth)로 측정
          resize={{ offsetSize: true }}
          gl={{ powerPreference: 'high-performance' }}
        >
          <color attach="background" args={[canvasBg]} />
          <fog attach="fog" args={[canvasBg, fogNear, fogFar]} />
          <DungeonScene
            key={`${runId}:${floorNo}`}
            floorNo={floorNo}
            heroVariant={mode}
            minimapRef={minimapRef}
            lite={lite}
            danger={dangerFloor === floorNo}
            seedOffset={runType === 'daily' ? dailyNum : 0}
            hidden={
              phase === 'doorrun' ||
              phase === 'arena' ||
              phase === 'arenaover' ||
              phase === 'village'
            }
            statsRef={statsRef}
            damageMulRef={damageMulRef}
            pausedRef={pausedRef}
            quizResultRef={quizResultRef}
            portalRetryRef={portalRetryRef}
            homeRetryRef={homeRetryRef}
            homeUsedRef={homeUsedRef}
            altarRetryRef={altarRetryRef}
            altarUsedRef={altarUsedRef}
            secretRetryRef={secretRetryRef}
            riftRetryRef={riftRetryRef}
            riftGoRef={riftGoRef}
            evoFxRef={evoFxRef}
            onDamage={onDamage}
            onHeal={onHeal}
            onKill={onKill}
            onExit={onExit}
            onChest={onChest}
            onHomeDoor={onHomeDoor}
            onBossHp={onBossHp}
            onBossDown={onBossDown}
            onTrace={onTrace}
            onGirl={onGirl}
            onAltar={onAltar}
            onSecret={onSecret}
            onRift={onRift}
            onCoins={onCoins}
          />
          {phase === 'doorrun' && (
            <DoorRunScene key={doorRound} quiz={quiz} heroVariant={mode} onDone={onDoorRunDone} />
          )}
          {phase === 'arena' && (
            <GemArenaScene
              key={arenaTry}
              floorNo={floorNo}
              lite={lite}
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
              heroVariant={mode}
              pausedRef={villagePausedRef}
              onNear={onVillageNear}
            />
          )}
          {/* 포스트프로세싱 — emissive(포털·탄막·보물·보스)가 실제로 '빛나게'.
              ✨고품질에서만 — ⚡가벼움 모드는 컴포저 없이 직접 렌더(기존 경로). MSAA 2로 비용 절충 */}
          {!lite && (
            <EffectComposer multisampling={2}>
              <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.58} luminanceSmoothing={0.3} radius={0.75} />
              <Vignette eskil={false} offset={0.24} darkness={0.52} />
            </EffectComposer>
          )}
        </Canvas>
      )}

      {/* 미니맵 — 절차 생성 던전을 눈으로 (탐사한 곳만 밝혀짐) */}
      {inDungeonUi && phase !== 'doorrun' && <MiniMap chRef={minimapRef} />}

      {/* 처치 콤보 칩 — 3초 안에 이어서 처치하면 코인 배율 */}
      {inDungeonUi && combo.n >= 2 && (
        <div className="combo-chip" key={combo.seq}>
          🔥 {combo.n} 콤보{combo.mult > 1 ? ` · 코인 ×${combo.mult}` : ''}
        </div>
      )}

      {/* ── HUD (z-index 50 — 오버레이 위) ── */}
      {inDungeonUi && (
        <GameHud
          mode={mode}
          daily={runType === 'daily'}
          floorNo={floorNo}
          hp={hp}
          maxHp={stats.maxHp}
          kills={kills}
          coins={coins}
          muted={muted}
          gfx={gfx}
          danger={dangerFloor === floorNo}
          onToggleMute={toggleMute}
          onToggleGfx={toggleGfx}
        />
      )}
      {phase === 'arena' && (
        <ArenaHud
          hp={arenaHp}
          max={arenaMax}
          gems={arenaGems}
          muted={muted}
          onToggleMute={toggleMute}
        />
      )}
      {inDungeonUi && Object.keys(build).length > 0 && <BuildRow build={build} />}
      {/* 보스 체력바 — 마을(town/village)에서는 숨김 (숨은 DungeonScene이 보고해도 표시 안 함) */}
      {inDungeonUi && bossMax > 0 && bossHp > 0 && <BossBar hp={bossHp} max={bossMax} />}

      {/* ── 걸어다니는 마을 오버레이 ── */}
      {phase === 'village' && (
        <>
          <VillageHud
            stageName={VILLAGE_STAGE_NAMES[vStage]}
            muted={muted}
            onToggleMute={toggleMute}
          />
          <VillageOverlay
            near={villageNear}
            talk={villageTalk}
            giftName={giftName}
            keysLocked={debugOpen}
            onTalk={talkTo}
            onAdvanceLine={advanceTalkLine}
            onChoose={chooseTalkOption}
          />
        </>
      )}

      {/* 🏠 '돌아갈 곳' 발동 알림 — 흐름을 끊지 않게 배너로만 */}
      {reviveNotice > 0 && phase === 'run' && (
        <div key={`rv${reviveNotice}`} className="revive-banner">
          🚪 돌아갈 곳 — 기다리는 사람이 있다. 다시 일어섰다!
        </div>
      )}

      {/* 전체 화면 플래시·펄스는 디버그 모드에서 끔 — 반복 테스트 시 눈 피로 (소리 신호는 유지) */}
      {!debugAllowed && flash > 0 && <div key={`f${flash}`} className="hit-flash" />}
      {!debugAllowed && goldFlash > 0 && <div key={`g${goldFlash}`} className="hit-flash gold" />}
      {!debugAllowed && lowHp && <div className="low-hp" />}

      {/* ── 미니게임 조작 힌트 ── */}
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

      {/* ── phase별 오버레이 화면 ── */}
      {phase === 'title' && (
        <TitleScreen
          best={best}
          memCount={memCount}
          memIds={memIds}
          storySeen={storySeen}
          muted={muted}
          gfx={gfx}
          dexPct={dexPct(dex)}
          dailyRecord={dailyBest?.date === todayKey() ? dailyBest : null}
          onToggleMute={toggleMute}
          onToggleGfx={toggleGfx}
          onDex={() => {
            sfx.tap();
            setPhase('dex');
          }}
          onStart={startAdventure}
          onDaily={() => enterDungeon(undefined, 'daily')}
          onReplay={replayStory}
          onDemo={startDemo}
        />
      )}
      {phase === 'dex' && (
        <DexScreen
          dex={dex}
          claimed={dexClaimed}
          onBack={() => {
            sfx.tap();
            setPhase('title');
          }}
        />
      )}
      {phase === 'story' && (
        <StoryScreen
          idx={storyIdx}
          answer={storyAnswer}
          onAnswer={setStoryAnswer}
          onAdvance={advanceStory}
          onSkip={() => {
            sfx.tap();
            setStoryAnswer(null);
            goVillage('enter', true);
          }}
        />
      )}
      {phase === 'town' && townNode && (
        <TownDialogScreen
          node={townNode}
          floorNo={floorNo}
          townMode={townMode}
          scape={townScape}
          giftName={giftName}
          keysLocked={debugOpen}
          onAdvance={(next) => {
            sfx.tap();
            setTownIdx(next);
          }}
          onChoose={chooseTownOption}
        />
      )}
      {phase === 'portal' && (
        <PortalScreen
          floorNo={floorNo}
          danger={branchOpen}
          onDescend={() => {
            sfx.tap();
            setPhase('draft');
          }}
          onDanger={() => {
            // 모험의 길 — 다음 층에 위험 계약 (그 층 돌파 보상은 전부 레어 이상)
            sfx.roar();
            buzz(30);
            setDangerFloor(floorNo + 1);
            setPhase('draft');
          }}
          onStay={stayOnFloor}
        />
      )}
      {phase === 'homedoor' && <HomeDoorScreen onOpen={openHomeDoor} onSkip={skipHomeDoor} />}
      {phase === 'altar' && (
        <AltarScreen
          hp={hp}
          cost={altarCost}
          reward={altarReward}
          onOffer={offerAltar}
          onDecline={declineAltar}
          onContinue={() => {
            sfx.tap();
            setPhase('run');
          }}
        />
      )}
      {phase === 'rift' && <RiftScreen onEnter={enterRift} onDecline={declineRift} />}
      {phase === 'secretdoor' && (
        <SecretDoorScreen floorNo={floorNo} onJump={jumpSecret} onDecline={declineSecret} />
      )}
      {phase === 'arenaover' && (
        <ArenaOverScreen gems={arenaDeathGems} onRetry={retryArena} onBail={bailArena} />
      )}
      {phase === 'quiz' && (
        <QuizResultScreen
          view={quizView}
          mode={mode}
          doorRound={doorRound}
          rewards={rewards}
          answerText={quiz.answers[quiz.correct]}
          onTakeReward={takeRewardNow}
          onRunDeeper={runDeeper}
          onContinue={continueFromQuiz}
        />
      )}
      {phase === 'memory' && (
        <MemoryScreen
          memory={memory}
          collected={memIds.includes(memory.id) ? memIds : [...memIds, memory.id]}
          max={MEMORIES.length}
          onClose={closeMemory}
        />
      )}
      {phase === 'memset' && setUnlocked && (
        <MemorySetScreen setId={setUnlocked} collected={memIds} onContinue={closeMemSet} />
      )}
      {phase === 'memfull' && (
        <MemFullScreen
          total={MEMORIES.length}
          rewards={memRewards}
          onContinue={() => {
            sfx.tap();
            setPhase('run');
          }}
        />
      )}
      {phase === 'ending' && (
        <EndingScreen
          variant={endingVariant}
          idx={endingIdx}
          girlMet={girlMet}
          kills={kills}
          memCount={memCount}
          onPickVariant={(v) => {
            sfx.tap();
            setEndingVariant(v);
          }}
          onNext={() => {
            sfx.tap();
            setEndingIdx((i) => i + 1);
          }}
          onTitle={() => {
            sfx.tap();
            setPhase('title');
          }}
          onShare={() => {
            sfx.tap();
            void shareCard({
              floor: 100,
              kills,
              mem: memCount,
              memMax: MEMORIES.length,
              best,
              mode,
              cleared: true,
              daily: runType === 'daily' ? todayKey() : undefined,
            });
          }}
        />
      )}
      {phase === 'trace' && (
        <TraceScreen
          floorNo={floorNo}
          onContinue={() => {
            sfx.tap();
            setPhase('run');
          }}
        />
      )}
      {phase === 'lore' && (
        <LoreScreen
          floorNo={floorNo}
          onContinue={() => {
            sfx.tap();
            setPhase('run');
          }}
        />
      )}
      {phase === 'draft' && <DraftScreen floorNo={floorNo} draft={draft} onPick={pickUpgrade} />}
      {phase === 'over' && (
        <OverScreen
          floorNo={floorNo}
          kills={kills}
          best={best}
          coins={coins}
          lore={overLore}
          checkpointFloor={checkpointFloor}
          daily={runType === 'daily'}
          onResume={resumeFromCheckpoint}
          onRetry={() => enterDungeon()}
          onVillage={() => goVillage('enter')}
          onShare={() => {
            sfx.tap();
            void shareCard({
              floor: floorNo,
              kills,
              mem: memCount,
              memMax: MEMORIES.length,
              best,
              mode,
              daily: runType === 'daily' ? todayKey() : undefined,
            });
          }}
        />
      )}
      {phase === 'shop' && (
        <ShopScreen
          coins={coins}
          meta={meta}
          onBuy={buyUpgrade}
          onBack={() => {
            sfx.tap();
            setPhase('village');
          }}
        />
      )}

      {/* ── 디버그 층 이동 (Shift+D) — 메뉴 스택 맨 위라 아래 메뉴 키 입력 차단 ── */}
      {debugAllowed && debugOpen && runId > 0 && (
        <DebugPanel onJump={debugJump} onClose={() => setDebugOpen(false)} />
      )}

      {/* ── 자동 시연 (?demo) — JSX 맨 끝 = 메뉴 스택 맨 위 (타이틀 메뉴보다 우선) ── */}
      {demoRunning && demoCaption && <DemoCaption text={demoCaption} />}
      {demoRunning && <DemoExitButton />}
      {demoDone && !demoRunning && <DemoEndScreen onReplay={replayDemo} />}
    </div>
  );
}
