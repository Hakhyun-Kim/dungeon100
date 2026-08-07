// GameAnalytics (GA) 텔레메트리 파사드
// 배포판 실유저 데이터 수집 / 봇·시연·CI 환경 수집 차단 격리

import { gameanalytics } from 'gameanalytics';
import { GA_KEYS } from './gaKeys';

const GameAnalytics = (gameanalytics as any).GameAnalytics;

let isInitialized = false;

// 1. GA 초기화
export function initAnalytics(): boolean {
  if (isInitialized) return true;
  if (typeof window === 'undefined') return false;

  const gameKey = import.meta.env.VITE_GA_GAME_KEY || GA_KEYS.gameKey;
  const secretKey = import.meta.env.VITE_GA_SECRET_KEY || GA_KEYS.secretKey;

  if (!gameKey || !secretKey) {
    if (import.meta.env.DEV) {
      console.log('[Analytics] GA keys missing (VITE_GA_* env or src/lib/gaKeys.ts). Quiet mock mode enabled.');
    }
    return false;
  }

  try {
    GameAnalytics.configureBuild('0.1.0');
    GameAnalytics.configureAvailableResourceCurrencies(['coins']);
    GameAnalytics.configureAvailableResourceItemTypes(['upgrade']);
    GameAnalytics.configureAvailableCustomDimensions01(['adult', 'kids', 'monster']);
    
    if (import.meta.env.DEV) {
      GameAnalytics.setEnabledInfoLog(true);
    }

    GameAnalytics.initialize(gameKey, secretKey);
    isInitialized = true;
    console.log('[Analytics] GameAnalytics initialized successfully.');
    return true;
  } catch (err) {
    console.warn('[Analytics] Failed to initialize GameAnalytics:', err);
    return false;
  }
}

// 2. 봇 / 시연 / 헤드리스 스모크 등 실유저가 아닌 시뮬레이션 감지
export function isTelemetryAllowed(): boolean {
  if (!isInitialized) return false;
  if (typeof window === 'undefined') return false;

  const win = window as any;
  // 자동 시연 중 (Demo)
  if (win.__d100demo || win.location?.search?.includes('demo') || sessionStorage.getItem('d100-demo-auto')) {
    return false;
  }
  // 밸런스 시뮬봇 실행 중 (SimBot)
  if (win.__d100simActive || win.__d100sim) {
    return false;
  }
  // 헤드리스 / rafshim 자동 테스트
  if (win.location?.search?.includes('rafshim')) {
    return false;
  }

  return true;
}

// 3. 던전 층 진행 이벤트 (Progression)
export function trackProgression(
  status: 'Start' | 'Complete' | 'Fail',
  mode: string,
  floorNo: number,
  score?: number,
  deathCause?: string,
) {
  if (!isTelemetryAllowed()) return;

  const gaStatus =
    status === 'Start'
      ? 1 // EGAProgressionStatus.Start
      : status === 'Complete'
      ? 2 // EGAProgressionStatus.Complete
      : 3; // EGAProgressionStatus.Fail

  const progression01 = mode || 'adult';
  const progression02 = `floor_${String(floorNo).padStart(3, '0')}`;
  const progression03 = deathCause || undefined;

  try {
    GameAnalytics.addProgressionEvent(gaStatus, progression01, progression02, progression03, score);
  } catch (e) {
    // Analytics failures must never crash game loop
  }
}

// 4. 드래프트 카드 선택 이벤트 (Design)
export function trackDraftPick(cardId: string, floorNo?: number) {
  if (!isTelemetryAllowed()) return;
  try {
    const eventId = `draft:pick:${cardId}`;
    GameAnalytics.addDesignEvent(eventId, floorNo);
  } catch (e) {}
}

// 5. 방 이벤트 (제단, 찢어진 페이지, 두 갈래 틈, 무너지는 서가, 몬스터 하우스)
export function trackRoomEvent(eventName: string, action: 'accept' | 'decline' | 'use' | 'shake' | 'enter') {
  if (!isTelemetryAllowed()) return;
  try {
    const eventId = `room_event:${eventName}:${action}`;
    GameAnalytics.addDesignEvent(eventId);
  } catch (e) {}
}

// 6. 보스 처치 / 사망 이벤트
export function trackBossEvent(bossName: string, floorNo: number, result: 'kill' | 'death') {
  if (!isTelemetryAllowed()) return;
  try {
    const eventId = `boss:${result}:${bossName}`;
    GameAnalytics.addDesignEvent(eventId, floorNo);
  } catch (e) {}
}

// 7. 특수 능력 사용 (찰나 ❄️ / 결의 💨)
export function trackAbilityUse(ability: 'freeze' | 'resolve') {
  if (!isTelemetryAllowed()) return;
  try {
    const eventId = `ability:${ability}:use`;
    GameAnalytics.addDesignEvent(eventId);
  } catch (e) {}
}

// 8. 미니게임 결과 (두 문 달리기 DoorRun / 몬스터 아레나 GemArena)
export function trackMinigame(gameType: 'doorrun' | 'gemarena', result: 'win' | 'fail' | 'retry', value?: number) {
  if (!isTelemetryAllowed()) return;
  try {
    const eventId = `minigame:${gameType}:${result}`;
    GameAnalytics.addDesignEvent(eventId, value);
  } catch (e) {}
}

// 9. 대장간 매수 / 재화 지출
export function trackShopPurchase(itemId: string, cost: number) {
  if (!isTelemetryAllowed()) return;
  try {
    // EGAResourceFlowType.Sink = 2
    GameAnalytics.addResourceEvent(2, 'coins', cost, 'upgrade', itemId);
    GameAnalytics.addDesignEvent(`shop:buy:${itemId}`, cost);
  } catch (e) {}
}

// 10. 에러 트래킹
export function trackError(message: string) {
  if (!isTelemetryAllowed()) return;
  try {
    // EGAErrorSeverity.Error = 4
    GameAnalytics.addErrorEvent(4, message);
  } catch (e) {}
}
