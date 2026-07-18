import { mulberry32 } from './rng';

// 두 문 달리기의 수수께끼 — 두 문 러너의 "정답 문 고르기"를 미니게임으로 이식.
// 문제 은행 없이 절차 생성하며, 던전 종류(초등/어른)와 층 깊이에 따라 어려워진다.
// 'monster'는 수학 대신 몬스터 아레나로 보물을 얻는 모드 — makeQuiz는 호출되지 않는다.
export type DungeonMode = 'kids' | 'adult' | 'monster';

// 두 문 달리기 최대 연속 라운드 — 완주(3문) = 전설 보물
export const MAX_DOOR_ROUND = 3;

export interface Quiz {
  q: string;
  answers: [string, string]; // 왼쪽 문 / 오른쪽 문
  correct: 0 | 1;
}

export function makeQuiz(seed: number, level: number, mode: DungeonMode): Quiz {
  const rand = mulberry32(seed);
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  let q: string;
  let ans: number;

  if (mode === 'kids') {
    // 🎒 초등학교 던전 — 초등 눈높이로 완만하게
    if (level < 6) {
      // 한 자리 덧셈/뺄셈 (받아올림 조금)
      const a = ri(2, 9);
      const b = ri(2, 9);
      if (rand() < 0.5) {
        q = `${a} + ${b}`;
        ans = a + b;
      } else {
        const [x, y] = a >= b ? [a, b] : [b, a];
        q = `${x} - ${y}`;
        ans = x - y;
      }
    } else if (level < 12) {
      // 두 자리 덧셈/뺄셈
      const a = ri(11, 49);
      const b = ri(11, 49);
      if (rand() < 0.5) {
        q = `${a} + ${b}`;
        ans = a + b;
      } else {
        const [x, y] = a >= b ? [a, b] : [b, a];
        q = `${x} - ${y}`;
        ans = x - y;
      }
    } else if (level < 20) {
      // 곱셈구구
      const a = ri(2, 9);
      const b = ri(2, 9);
      q = `${a} × ${b}`;
      ans = a * b;
    } else {
      // 두 자리 × 한 자리 (작게)
      const a = ri(12, 29);
      const b = ri(3, 6);
      q = `${a} × ${b}`;
      ans = a * b;
    }
  } else {
    // 🧠 어른 던전 — 암산 훈련 코스
    if (level < 4) {
      // 두 자리 덧셈/뺄셈 (큰 수)
      const a = ri(23, 98);
      const b = ri(17, 89);
      if (rand() < 0.5) {
        q = `${a} + ${b}`;
        ans = a + b;
      } else {
        const [x, y] = a >= b ? [a, b] : [b, a];
        q = `${x} - ${y}`;
        ans = x - y;
      }
    } else if (level < 10) {
      // 두 자리 × 한 자리
      const a = ri(13, 39);
      const b = ri(3, 9);
      q = `${a} × ${b}`;
      ans = a * b;
    } else if (level < 20) {
      // 혼합 연산
      const a = ri(4, 9);
      const b = ri(4, 9);
      const c = ri(11, 79);
      q = `${a} × ${b} + ${c}`;
      ans = a * b + c;
    } else {
      // 두 자리 × 두 자리 (작은 범위)
      const a = ri(11, 19);
      const b = ri(11, 29);
      q = `${a} × ${b}`;
      ans = a * b;
    }
  }

  // 오답은 실제로 헷갈릴 만한 근접값으로
  let wrong = ans;
  let guard = 0;
  while (wrong === ans && guard++ < 10) {
    const kind = rand();
    const sign = rand() < 0.5 ? 1 : -1;
    if (kind < 0.4) wrong = ans + ri(1, 3) * sign;
    else if (kind < 0.7) wrong = ans + 10 * sign;
    else wrong = ans + ri(4, 9) * sign;
    if (wrong < 0) wrong = ans + ri(1, 9);
  }

  const correct: 0 | 1 = rand() < 0.5 ? 0 : 1;
  const answers: [string, string] =
    correct === 0 ? [String(ans), String(wrong)] : [String(wrong), String(ans)];
  return { q: `${q} = ?`, answers, correct };
}
