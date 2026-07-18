import { useEffect, useRef } from 'react';
import { sfx } from '../lib/sound';

// ── 자동 시연 드라이버 (?demo) — 실제 게임을 그대로 플레이하며 자막과 함께 보여준다.
//    이동은 합성 키보드 이벤트(useMoveInput/useSteer가 window 키 이벤트 기반이라 그대로 먹힘),
//    장면 전환은 App이 넘겨준 게임 조작 프리미티브(DemoActions)로 직접 진행.
//    DEV 훅을 안 쓰므로 프로덕션 빌드에서도 동작 — 심사자가 링크 클릭 한 번으로 관람.
export interface DemoActions {
  /** 자막 갱신 (빈 문자열 = 숨김) */
  caption: (text: string) => void;
  /** 최신 phase 조회 */
  phase: () => string;
  /** 걸어다니는 마을 진입 */
  village: (ctx: 'enter' | 'visit') => void;
  /** 촌장 첫 대화 강제 오픈 (가짜 선택 개그 포함) */
  chiefTalk: () => void;
  /** kids 모드로 새 런 시작 */
  dungeon: () => void;
  /** 전설 보물 즉시 지급 (Shift+P와 동일, run phase 전용) */
  treasure: () => void;
  /** 두 문 달리기 시작 */
  doorrun: () => void;
  /** 몬스터 아레나 시작 */
  arena: () => void;
  /** 층 점프 (체력 회복 포함) */
  jump: (floor: number) => void;
  /** 층 번호만 변경 (장면 연출용) */
  setFloor: (n: number) => void;
  /** 56층 소녀 찻자리 직접 진입 (girlMet 저장 안 함 — 심사자 세이브 비오염) */
  girlTea: () => void;
  /** 시연 종료 — 타이틀 복귀 + 끝 화면 */
  finish: () => void;
}

export function useDemoDriver(running: boolean, actions: DemoActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!running) return;
    const act = () => actionsRef.current;
    let stop = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    const key = (code: string, down: boolean) =>
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    const releaseAll = () => ['ArrowLeft', 'ArrowRight', ...MOVE_KEYS].forEach((c) => key(c, false));
    const OVERLAYS = ['lore', 'memory', 'trace', 'quiz', 'portal', 'draft', 'homedoor', 'altar', 'secretdoor', 'memfull', 'arenaover', 'over'];
    // 떠 있는 오버레이를 잠깐 보여준 뒤 자연스럽게 넘긴다 (스토리도 시연의 일부)
    const clickOverlay = () => {
      const card = document.querySelector<HTMLButtonElement>('.draft-screen .card');
      if (card) return card.click();
      const choices = [
        ...document.querySelectorAll<HTMLButtonElement>('.screen .dialog-choices .choice-btn'),
      ].filter((b) => !b.disabled);
      // 포털·마을 문·방 이벤트는 거절 — 시연 동선은 드라이버가 층 점프로 직접 잡는다
      const declinePhases = ['portal', 'homedoor', 'altar', 'secretdoor'];
      if (choices.length >= 2 && declinePhases.includes(act().phase()))
        return choices[1].click();
      if (choices.length > 0) return choices[0].click();
      document.querySelector<HTMLButtonElement>('.screen .big-btn')?.click();
    };
    const settle = async () => {
      if (OVERLAYS.includes(act().phase())) {
        await sleep(1500); // 관객이 읽을 시간
        if (!stop) clickOverlay();
        await sleep(400);
      }
    };
    // 마을(.village-talk)·소녀 찻자리(.town-screen) 대화를 읽는 속도로 진행.
    // 선택지가 나오면 "다른 방법은 없나요?" 같은 개그 선택지를 우선 고른다.
    const clickTalk = () => {
      const choices = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '.village-talk .choice-btn, .town-screen .dialog-choices .choice-btn',
        ),
      ].filter((b) => !b.disabled);
      if (choices.length > 0) {
        const gag = choices.find((b) => b.textContent?.includes('다른 방법'));
        return (gag ?? choices[0]).click();
      }
      document
        .querySelector<HTMLElement>('.village-talk .dialog-box, .town-screen .dialog-box')
        ?.click();
    };
    const talkFor = async (ms: number) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !stop) {
        await sleep(1800);
        if (!stop) clickTalk();
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
      while (Date.now() < until && !stop && !want.includes(act().phase())) {
        if (act().phase() === 'doorrun') {
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
      act().caption(text);
      sfx.tap();
      await sleep(1900);
    };

    const tour = async () => {
      await caption('🏘️ 모험은 걸어다니는 마을에서 시작됩니다');
      act().village('enter');
      await wander(2600);
      if (stop) return;

      await caption('👵 촌장과 대화 — "혹시 다른 방법은 없나요?" …선택지는 가끔 하나뿐!');
      act().chiefTalk();
      await talkFor(11000);
      if (stop) return;

      await caption('⚔️ 매판 새로 생성되는 던전 — 가까운 적은 자동 조준!');
      act().dungeon();
      await wander(5000);
      if (stop) return;

      await caption('🎁 보물은 빌드로 바로 보입니다 — 궤도 구슬, 커지는 투사체!');
      for (let i = 0; i < 3 && !stop; i++) {
        act().treasure();
        await sleep(1200);
      }
      await wander(2500);
      if (stop) return;

      await caption('🚪 미니게임 ① 두 문 달리기 — 정답이 적힌 문을 몸으로!');
      act().doorrun();
      {
        const until = Date.now() + 9000;
        while (Date.now() < until && !stop && act().phase() === 'doorrun') {
          const c = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
          key(c, true);
          await sleep(320 + Math.random() * 320);
          key(c, false);
        }
        releaseAll();
      }
      await settleUntil(['run'], 10000); // 결과·기억 회상까지 넘기고 던전 복귀
      if (stop) return;

      await caption('👹 미니게임 ② 몬스터 아레나 — 무리를 뚫고 보석 3개!');
      act().arena();
      await wander(9000);
      if (stop) return;

      await caption('🌊 깊이 = 이야기의 진행 — 10층마다 던전의 색이 변하고 안개가 짙어집니다');
      act().jump(45);
      await sleep(300);
      act().treasure();
      await wander(4000);
      act().jump(75);
      await sleep(300);
      act().treasure();
      await wander(4000);
      if (stop) return;

      await caption('🫖 56층의 소녀 — 작가가 쓰다 만 「공주님」, 여백의 찻자리');
      act().setFloor(56);
      await sleep(300);
      act().girlTea();
      await talkFor(9500);
      if (stop) return;

      await caption('🌅 깊이 내려가면 마을에도 시간이 흐릅니다 — 습격, 방벽, 그리고 폐허와 새벽');
      act().setFloor(85);
      act().village('visit');
      await wander(6000);
      if (stop) return;

      await caption('📖 10층마다 페이지의 수호자가 포털을 봉인합니다 — 탄막을 뚫어라!');
      act().jump(30);
      await sleep(300);
      act().treasure();
      await wander(9000);
      if (stop) return;

      await caption('✨ 56층의 소녀, 100층의 황금 문, 엔딩과 에필로그는 — 직접 확인해 보세요!');
      await sleep(2600);
      releaseAll();
      act().finish();
    };
    void tour();
    return () => {
      stop = true;
      releaseAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
}
