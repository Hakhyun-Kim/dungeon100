// 인트로 스토리와 마을 대화 스크립트.
// 선택지는 사실상 하나뿐이지만(개그 포인트), "내가 골라서 간다"는 감각을 준다.

export interface StorySlide {
  icon: string;
  text: string;
}

export const STORY_SLIDES: StorySlide[] = [
  {
    icon: '📚',
    text: '2026년, 대한민국. 기말고사가 끝난 밤.\n나는 도서관에서 빌린 낡은 책을 읽고 있었다.\n제목은 — 『백층 던전의 비밀』.',
  },
  {
    icon: '🕯️',
    text: '"백 개의 층을 내려간 자, 어떤 문이든 열 수 있다."\n\n…웬 판타지 설정집이 이렇게 디테일하지?\n라고 생각한 것이 그날 밤의 마지막 기억이다.',
  },
  {
    icon: '🌄',
    text: '눈을 떴을 때, 천장이 낯설었다.\n정확히는 — 천장이 없었다.\n\n책 43쪽 삽화에서 본 그 마을이, 눈앞에 있었다.',
  },
  {
    icon: '🩳',
    text: '주머니엔 지갑도, 폰도, 충전기도 없다.\n있는 건 어제 입고 잔 잠옷뿐.\n\n[ 현재 스탯 — 힘: 0 · 돈: 0 · 당황: 100 ]',
  },
  {
    icon: '🏔️',
    text: '그리고 마을 뒤편에는,\n책 표지에 그려져 있던 바로 그 던전이\n시커먼 입을 벌리고 있었다.',
  },
];

export type TownNode =
  | { kind: 'line'; icon: string; speaker: string; text: string; next: number }
  | {
      kind: 'choice';
      prompt: string;
      options: { label: string; next?: number; enter?: boolean }[];
    };

// 첫 방문 — 촌장에게 퀘스트를 받고 던전 입구까지
export const TOWN_FIRST: TownNode[] = [
  {
    kind: 'line',
    icon: '🧑‍🎓',
    speaker: '나',
    text: '진짜로 그 마을이잖아?! 책에서 본 광장, 우물, 그리고… 할머니?',
    next: 1,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '오, 또 떨어졌구먼! 몇 년도에서 왔나? 2026? 쯧쯧, 요즘 애들은 참 자주 떨어져.',
    next: 2,
  },
  {
    kind: 'line',
    icon: '🧑‍🎓',
    speaker: '나',
    text: '저기요, 집에 돌아가려면 어떻게 해야 하나요? 내일 알바도 있단 말이에요.',
    next: 3,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: "마을 뒤 백층 던전. 그 가장 깊은 곳에 '집으로 가는 문'이 있다는 전설이 있지. 지금까지 끝까지 간 사람은… 음, 아직 없지만!",
    next: 4,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: "참, 던전의 보물상자는 '두 문의 시험'을 걸어온단다. 정답이 적힌 문을 몸으로 열어야 보물을 주지. 깊이 달릴수록 좋은 보물이 나온다는 소문이야.",
    next: 5,
  },
  {
    kind: 'choice',
    prompt: '어떻게 할까?',
    options: [
      { label: '⚔️ 퀘스트 수락 — 백층 던전 탐험', next: 7 },
      { label: '🙋 혹시… 다른 방법은 없나요?', next: 6 },
    ],
  },
  { kind: 'line', icon: '👵', speaker: '촌장', text: '없어.', next: 5 },
  {
    kind: 'line',
    icon: '🧑‍🎓',
    speaker: '나',
    text: '(돈 0원, 힘 0, 아는 사람 0… 어차피 선택지는 하나다.)\n좋아. 가 보자, 백층 던전.',
    next: 8,
  },
  {
    kind: 'choice',
    prompt: '던전 입구에 섰다. 안쪽에서 서늘한 바람이 불어온다.',
    options: [
      { label: '🕯️ 들어간다', enter: true },
      { label: '😮‍💨 잠깐, 마음의 준비가…', next: 9 },
    ],
  },
  {
    kind: 'line',
    icon: '🧑‍🎓',
    speaker: '나',
    text: '…후우우. 심호흡 완료. (용기 +1)',
    next: 8,
  },
];

// 재방문 — 게임오버 후 마을에서 쉬어 갈 때
export const TOWN_REVISIT: TownNode[] = [
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '살아 돌아왔구먼! 제법 버텼어. 여관 침대는 공짜로 빌려주지 — 어차피 자네가 이 마을 유일한 모험가거든.',
    next: 1,
  },
  {
    kind: 'choice',
    prompt: '몸이 가뿐해졌다. 다시 던전으로?',
    options: [
      { label: '⚔️ 들어간다', enter: true },
      { label: '🛏️ 조금만 더 쉬고…', next: 2 },
    ],
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '푹 쉬었으면 얼른 다녀와! 100층 끝의 문, 나도 궁금하단 말이야.',
    next: 1,
  },
];
