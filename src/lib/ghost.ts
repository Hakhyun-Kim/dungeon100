// AI 사서 고스트 — "이 책을 먼저 읽은 AI"가 이번 판에서 몇 층까지 읽고 잠들었는지.
//
// 실체는 밸런스 시뮬봇(simBot, DEV 전용)이 수천 판으로 남긴 실측 분포에 맞춰 보정한
// **추상 층별 시뮬레이션**이다: 층마다 [성장(아이템 누적·소프트캡)] vs [위협(깊은 층
// 위협 램프·보스/수문장 스파이크·운)]을 겨루게 해 사망 층을 정한다. 본편과 같은
// 공식 구조(threatFloor = f + max(0,f-30)×0.6)를 쓰므로 "AI가 만들고 AI가 검증한
// 밸런스 모델"이 그대로 인게임 경쟁 상대가 된다.
//
// 순수 함수: 같은 시드 → 같은 기록. 일일 던전은 날짜 시드라 모두가 같은 사서와 겨룬다.
// 보정 기준(2026-07-24): 시뮬봇 하드런 실측 사망 6·6·9·9·10·10(평균 8.3)에 맞춰
// 2만 시드 분포로 상수 확정 — p10=4 · 중앙값 8 · p90=13 · 15층+ 7% · 20층+ 3% · 최대 33.
// (튜닝 스크립트는 스탯 공식만 복제한 1회용 — 상수를 바꾸면 분포를 다시 재서 여기 갱신)
import { mulberry32 } from './rng';

export interface GhostRecord {
  floor: number; // 사서가 잠든 층 (이보다 깊이 가면 '사서를 넘어섰다')
  cause: 'boss' | 'guardian' | 'horde'; // 무엇에게 당했나 (게임오버 문구용)
}

export function ghostRun(seed: number): GhostRecord {
  const rand = mulberry32((seed ^ 0x5eed1b) >>> 0);
  let items = 0;
  for (let f = 1; f <= 100; f++) {
    // 성장 — 층당 드래프트 1장 + 보물상자(두 문/아레나) 성공 시 추가 (봇의 평균 성공률 반영)
    items += 1 + (rand() < 0.55 ? 1 : 0) + (rand() < 0.18 ? 1 : 0);
    const power = 1 + Math.pow(items, 0.85) * 0.18; // 소프트캡 성장 (복리 완화 밸런스 반영)
    // 위협 — 본편 '깊은 층 위협 램프'와 같은 꼴 (30층+ 가속)
    const threatFloor = f + Math.max(0, f - 30) * 0.6;
    let danger = (0.82 + threatFloor * 0.155) * (0.68 + rand() * 0.6);
    let cause: GhostRecord['cause'] = 'horde';
    if (f % 10 === 0) {
      danger *= 1.5; // 페이지의 수호자
      cause = 'boss';
    } else if (f >= 4 && rand() < 0.45) {
      danger *= 1.18; // 출구 수문장의 돌진
      cause = 'guardian';
    }
    if (f <= 2) danger *= 0.4; // 시작 방 안전지대 — 1~2층에서 잠드는 사서는 없다
    if (danger > power) return { floor: f, cause };
  }
  return { floor: 100, cause: 'horde' }; // 완주 — 사서도 가끔은 끝까지 읽는다 (거의 없음)
}

// 게임오버 화면용 사망 사유 문구
export const GHOST_CAUSE_TEXT: Record<GhostRecord['cause'], string> = {
  boss: '페이지의 수호자 앞에서',
  guardian: '수문장의 돌진에',
  horde: '몰려든 몬스터에 밀려',
};
