import { mulberry32 } from './rng';

// 보물상자의 수수께끼 — 두 문 러너의 "정답 문 고르기"를 미니게임으로 이식.
// 문제 은행 없이 층 깊이에 따라 어려워지는 산수 문제를 절차 생성한다.
export interface Quiz {
  q: string;
  answers: [string, string]; // 왼쪽 문 / 오른쪽 문
  correct: 0 | 1;
}

export function makeQuiz(seed: number, floorNo: number): Quiz {
  const rand = mulberry32(seed);
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  let q: string;
  let ans: number;
  if (floorNo < 4) {
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
  } else if (floorNo < 10) {
    // 곱셈구구
    const a = ri(3, 9);
    const b = ri(3, 9);
    q = `${a} × ${b}`;
    ans = a * b;
  } else if (floorNo < 20) {
    // 두 자리 × 한 자리
    const a = ri(12, 39);
    const b = ri(3, 9);
    q = `${a} × ${b}`;
    ans = a * b;
  } else {
    // 혼합 연산
    const a = ri(3, 9);
    const b = ri(3, 9);
    const c = ri(10, 60);
    q = `${a} × ${b} + ${c}`;
    ans = a * b + c;
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
