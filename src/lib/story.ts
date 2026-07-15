// 인트로 스토리, 마을 대화, 회상(기억), 벽의 글귀(로어) 스크립트.
// 세계관: 이 던전은 '쓰이다 만 책'이다. 마을은 서문, 100층의 문은 뒤표지.
// 보물은 잊어버린 집의 기억을 되돌려주고, 5층마다 책갈피(마을 문)가 꽂힌다.

// 인트로 — 중간에 책이 직접 문제를 내는 인터랙티브 장면이 있다 (답과 무관하게 빨려 들어가는 개그)
export type StoryNode =
  | { kind: 'slide'; icon: string; text: string }
  | {
      kind: 'quiz';
      icon: string;
      intro: string;
      q: string;
      answers: [string, string];
      correct: 0 | 1;
      okText: string;
      noText: string;
    };

export const STORY_NODES: StoryNode[] = [
  {
    kind: 'slide',
    icon: '📚',
    text: '2026년, 대한민국. 기말고사가 끝난 밤.\n나는 도서관에서 빌린 낡은 책을 읽고 있었다.\n제목은 — 『백층 던전의 비밀』.',
  },
  {
    kind: 'slide',
    icon: '🕯️',
    text: '"백 개의 층을 내려간 자, 어떤 문이든 열 수 있다."\n\n…웬 판타지 설정집이 이렇게 디테일하지?\n라고 생각한 순간이었다.',
  },
  {
    kind: 'quiz',
    icon: '❓',
    intro: '책의 글자들이 꿈틀거리더니, 페이지 한가운데에 질문이 떠올랐다.\n\n「대답하라, 읽는 자여.」',
    q: '7 × 8 = ?',
    answers: ['54', '56'],
    correct: 1,
    okText: '「…정답. 자격이 있군.」\n\n글자들이 소용돌이치며 나를 책 속으로 끌어당겼다!',
    noText: '「…아쉽군. 하지만 배짱은 마음에 든다.」\n\n글자들이 웃으며 나를 책 속으로 끌어당겼다! (어차피 끌려간다)',
  },
  {
    kind: 'slide',
    icon: '🌄',
    text: '눈을 떴을 때, 천장이 낯설었다.\n정확히는 — 천장이 없었다.\n\n책 43쪽 삽화에서 본 그 마을이, 눈앞에 있었다.',
  },
  {
    kind: 'slide',
    icon: '🩳',
    text: '주머니엔 지갑도, 폰도, 충전기도 없다.\n있는 건 어제 입고 잔 잠옷뿐.\n\n[ 현재 스탯 — 힘: 0 · 돈: 0 · 당황: 100 ]',
  },
  {
    kind: 'slide',
    icon: '🏔️',
    text: '그리고 마을 뒤편에는,\n책 표지에 그려져 있던 바로 그 던전이\n시커먼 입을 벌리고 있었다.',
  },
];

import type { DungeonMode } from './quiz';

export type TownNode =
  | { kind: 'line'; icon: string; speaker: string; text: string; next: number; gift?: 'item' | 'heal' }
  | {
      kind: 'choice';
      prompt: string;
      options: {
        label: string;
        next?: number;
        action?: 'enter' | 'return' | 'shop' | 'close';
        mode?: DungeonMode;
      }[];
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
    text: "참, 던전의 보물상자는 '두 문의 시험'을 걸어온단다. 정답이 적힌 문을 몸으로 열어야 보물을 주지. …아, 머리 쓰기 싫으면 '몬스터 던전'을 골라도 돼. 거기선 상자를 열면 문제 대신 괴물이 우르르 쏟아지는데, 그 틈의 보석을 주우면 된다더라. 쓰러져도 몇 번이고 다시 도전할 수 있다니 겁낼 것 없어.",
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
    prompt:
      '던전 입구에 섰다. 문이 세 갈래로 갈라져 있다 — 왼쪽 문엔 크레용 낙서, 가운데 문엔 어른의 필체, 오른쪽 문엔 발톱으로 긁은 자국이 나 있다.',
    options: [
      { label: '🎒 초등학교 던전 (쉬운 문제)', action: 'enter', mode: 'kids' },
      { label: '🧠 어른 던전 (어려운 문제)', action: 'enter', mode: 'adult' },
      { label: '👹 몬스터 던전 (문제 대신 전투)', action: 'enter', mode: 'monster' },
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

// 새 세션 입장 — 스토리를 이미 본 플레이어의 빠른 입구 (게임오버 직후가 아닐 때)
export const TOWN_ENTRY: TownNode[] = [
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '왔구먼! 오늘도 던전이 입을 벌리고 기다린다. 어느 쪽 문으로 들어갈 텐가?',
    next: 1,
  },
  {
    kind: 'choice',
    prompt: '던전 입구 — 왼쪽 문엔 크레용 낙서, 가운데 문엔 어른의 필체, 오른쪽 문엔 발톱 자국.',
    options: [
      { label: '🎒 초등학교 던전 (쉬운 문제)', action: 'enter', mode: 'kids' },
      { label: '🧠 어른 던전 (어려운 문제)', action: 'enter', mode: 'adult' },
      { label: '👹 몬스터 던전 (문제 대신 전투)', action: 'enter', mode: 'monster' },
      { label: '🛠️ 무크의 대장간 — 영구 강화 (🪙)', action: 'shop' },
      { label: '🚶 잠깐 마을 구경 좀…', next: 2 },
    ],
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '구경할 건 없어. 우물이 전부야.',
    next: 1,
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
      { label: '🎒 초등학교 던전 (쉬운 문제)', action: 'enter', mode: 'kids' },
      { label: '🧠 어른 던전 (어려운 문제)', action: 'enter', mode: 'adult' },
      { label: '👹 몬스터 던전 (문제 대신 전투)', action: 'enter', mode: 'monster' },
      { label: '🛠️ 무크의 대장간 — 영구 강화 (🪙)', action: 'shop' },
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

// ── 5층마다 나타나는 마을 문으로 들어갔을 때 (층 유지, 던전으로 복귀)
const TOWN_VISIT_5: TownNode[] = [
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: "어이쿠, 정말 던전 안의 문으로 나왔구먼! 옛말이 사실이었어 — '다섯 층마다 책갈피가 꽂힌다'고 했지.",
    next: 1,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '여관 소녀 니나',
    text: '모험가님! 얼굴이 반쪽이 됐어요. 우리 여관 특제 수프 먹고 가요. 서비스예요!',
    gift: 'heal',
    next: 2,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: "책갈피가 무슨 뜻이냐고? 글쎄다… 누군가 '어디까지 읽었는지' 표시해 두는 것 같지 않니?",
    next: 3,
  },
  {
    kind: 'choice',
    prompt: '몸이 따뜻해졌다.',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

const TOWN_VISIT_10: TownNode[] = [
  {
    kind: 'line',
    icon: '🧔',
    speaker: '대장장이 무크',
    text: '오, 소문의 잠옷 모험가! 벌써 10층을 뚫었다고? 그 차림으로?',
    next: 1,
  },
  {
    kind: 'line',
    icon: '🧔',
    speaker: '대장장이 무크',
    text: '이 마을엔 아이가 태어나지 않아. 아무도 늙지도 않지. …이상하지? 근데 아무도 이상해하지 않아. 나도 방금 처음으로 이상하다고 생각했네.',
    next: 2,
  },
  {
    kind: 'line',
    icon: '🧔',
    speaker: '대장장이 무크',
    text: '받게. 손님도 없는데 물건은 계속 만들어지거든, 이 손이. 멈추질 않아.',
    gift: 'item',
    next: 3,
  },
  {
    kind: 'choice',
    prompt: '무크의 손은 쇳가루가 아니라… 잉크로 얼룩져 있었다.',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

const TOWN_VISIT_15: TownNode[] = [
  {
    kind: 'line',
    icon: '🎩',
    speaker: '떠돌이 상인',
    text: "이런 데서 손님을 다 보는군. 나? 나도 자네처럼 '떨어진 사람'이었지.",
    next: 1,
  },
  {
    kind: 'line',
    icon: '🎩',
    speaker: '떠돌이 상인',
    text: '돌아가길 포기한 건 아니야. 그저… 어느 날부터 내가 몇 년도에서 왔는지 기억이 안 나. 무서운 건 던전이 아니라 그거였어.',
    next: 2,
  },
  {
    kind: 'line',
    icon: '🎩',
    speaker: '떠돌이 상인',
    text: '자네는 기억을 잘 붙들고 있나? 보물이 기억을 되돌려준다는 얘기, 들어 봤겠지. 이 던전은 잔인한 건지 다정한 건지 모르겠단 말이야.',
    next: 3,
  },
  {
    kind: 'line',
    icon: '🎩',
    speaker: '떠돌이 상인',
    text: '덤이야. 깊이 가는 손님한텐 서비스지.',
    gift: 'item',
    next: 4,
  },
  {
    kind: 'choice',
    prompt: '상인의 마차에는 바퀴가 없었다.',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

const TOWN_VISIT_20: TownNode[] = [
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '…20층. 여기까지 내려온 사람에게는 말해 주기로 정해 뒀단다.',
    next: 1,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: "나는 이 책을 '읽다가' 떨어진 게 아니야. 이 책을 '쓰던' 사람이란다. 마지막 장이 도무지 써지지 않아서… 그만, 이야기 안에 갇혀 버렸지.",
    next: 2,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '네가 한 층씩 내려갈 때마다 던전 벽에 문장이 하나씩 늘어난단다. 네 모험이 마지막 장을 대신 쓰고 있는 거야.',
    next: 3,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '100층의 문은 뒤표지란다. 책은 다 읽혀야 덮이는 법이지. …부탁한다, 얘야. 좋은 결말이 되어 다오.',
    gift: 'item',
    next: 4,
  },
  {
    kind: 'choice',
    prompt: '촌장의 눈가가 젖어 있었다.',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

const TOWN_VISIT_LATER: TownNode[] = [
  {
    kind: 'line',
    icon: '👧',
    speaker: '여관 소녀 니나',
    text: '또 왔네요! 이제 마을 최고 유명인사예요. 수프 리필해 드릴게요!',
    gift: 'heal',
    next: 1,
  },
  {
    kind: 'line',
    icon: '👵',
    speaker: '촌장',
    text: '얼마 안 남았구나. 좋은 결말을 부탁한다.',
    next: 2,
  },
  {
    kind: 'choice',
    prompt: '마을이 처음 왔을 때보다… 조금 밝아진 것 같다.',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

// ── 소녀의 흔적 (14·28·42·49층) — 56층으로 이어지는 복선
export const TRACES: Record<number, { icon: string; text: string }> = {
  14: {
    icon: '🖍️',
    text: '복도 구석, 색분필 낙서 — 웃는 얼굴과 꽃 한 송이.\n\n이 살벌한 던전에… 대체 누가?',
  },
  28: {
    icon: '🕊️',
    text: '작은 종이학이 가지런히 놓여 있다. 접은 지 얼마 안 된 듯 깨끗하다.\n\n…그러고 보니 이 주변만, 몬스터가 얼씬도 하지 않는다.',
  },
  42: {
    icon: '💌',
    text: '벽에 삐뚤빼뚤한 글씨:\n「내려오는 발소리, 다 들려요! 56층이에요. 차 마시러 오세요 🌼」\n\n…초대장?',
  },
  49: {
    icon: '🫖',
    text: '낡은 담요, 그리고 찻잔 두 개.\n하나는 아직 따뜻하다.\n\n— 가까워졌다.',
  },
};

// ── 56층, 이야기 속 소녀 '여백' — 작가가 쓰다 만 등장인물 (17층 글귀의 회수)
export const GIRL_SCRIPT: TownNode[] = [
  {
    kind: 'line',
    icon: '👧',
    speaker: '???',
    text: '어…? 손님이다! 진짜 손님!\n42층 초대장 보고 온 거예요?',
    next: 1,
  },
  {
    kind: 'line',
    icon: '🧑‍🎓',
    speaker: '나',
    text: '너, 여기서 뭐 하는 거야? 이 아래는 위험해!',
    next: 2,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '소녀',
    text: "위험하긴요. 몬스터들은 절 안 건드려요.\n전 '등장인물'이거든요. 그쪽 같은 '읽는 사람'이랑은 다르게요.",
    next: 3,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '소녀',
    text: "작가님이 절 쓰다가 멈추셨어요. 이름도 못 받았고요.\n그래서 다들 절 '여백'이라고 불러요. 페이지 사이 빈 곳에 사니까.",
    next: 4,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '여백',
    text: '그래서 뭐 어때요? 덕분에 전 이 책에서 제일 자유로운걸요.\n(활짝 웃는다)',
    next: 5,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '여백',
    text: "부탁 하나만요. 100층 문에 닿으면 작가님께 전해 주세요.\n— '마지막 장, 여기서 기다리고 있다'고.",
    next: 6,
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '여백',
    text: '아, 이것도 가져가요. 손님 대접용으로 아껴 둔 건데,\n차랑은 영 안 어울려서.',
    gift: 'item',
    next: 7,
  },
  {
    kind: 'choice',
    prompt: '화로 위 주전자가 김을 뿜는다.',
    options: [
      { label: '🍵 차 한 잔 얻어 마신다', next: 8 },
      { label: '⚔️ 이만 가 볼게, 고마워', action: 'return' },
    ],
  },
  {
    kind: 'line',
    icon: '👧',
    speaker: '여백',
    text: '따뜻하죠? 여관 니나 언니 레시피예요.\n…언니도 절 기억하고 있을까요?',
    gift: 'heal',
    next: 9,
  },
  {
    kind: 'choice',
    prompt: '찻잔 바닥에 작게 쓰여 있다: 「다음 이야기에서 만나요」',
    options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
  },
];

// 여백을 만났다면 엔딩에 한 장면이 더해진다
export const ENDING_GIRL_EXTRA: { icon: string; text: string } = {
  icon: '🌼',
  text: '문이 닫히기 직전 — 페이지 사이에서\n누군가 폴짝폴짝 뛰며 손을 흔든 것 같았다.\n\n「다음 이야기에서 만나요!」',
};

// ── 엔딩 (100층 — 페이지의 수호자를 쓰러뜨리고 황금 문 앞에서)
export const ENDING_ALONE: { icon: string; text: string }[] = [
  {
    icon: '🚪',
    text: '문고리에 손을 얹자, 등 뒤 멀리서 마을의 종소리가 들렸다.\n\n…돌아보지 않았다.',
  },
  {
    icon: '🛏️',
    text: '눈을 뜨니 익숙한 천장.\n책상 위엔 『백층 던전의 비밀』이 얌전히 덮여 있었다.',
  },
  {
    icon: '📖',
    text: '…그런데 책이, 어쩐지 얇아진 것 같았다.\n마지막 장을 펼치자 이렇게 쓰여 있었다.\n\n「그는 혼자 문을 나섰다. 마을에는 아직, 종소리가 울린다.」',
  },
];

export const ENDING_TOGETHER: { icon: string; text: string }[] = [
  {
    icon: '👵',
    text: '"할머니! 같이 가요. 마지막 장은 같이 쓰는 거예요."\n\n촌장은 한참 나를 바라보다가, 펜을 내려놓듯 웃었다.',
  },
  {
    icon: '🚪',
    text: '두 사람이 함께 문을 밀자,\n백 개의 층이 한 페이지씩 넘어가는 소리가 났다.',
  },
  {
    icon: '📖',
    text: '눈을 뜨니 익숙한 천장.\n책상 위 책의 마지막 장엔 이렇게 쓰여 있었다.\n\n「그리고 두 사람은 함께 문을 나섰다. — 끝」',
  },
  {
    icon: '🔔',
    text: '창밖 어딘가에서,\n은은한 종소리가 들린 것 같았다.',
  },
];

// ── 죽음의 위화감 — 죽을수록 "다시 쓰이고 있다"는 사실을 눈치챈다
const DEATH_LORE: string[] = [
  '…어라. 방금 분명히 쓰러졌는데.\n하나도 아프지가 않다…?',
  '또 여관 침대다. 이불까지 곱게 덮여 있다.\n누가 옮겨 주는 거지? 아니, 그보다 — 왜 상처가 하나도 없지?',
  '죽는 순간, 어렴풋이 들었다.\n사락 — 페이지가 넘어가는 소리.',
  '니나에게 물어봤다. "저 어제… 죽지 않았어요?"\n니나는 웃기만 했다. "주인공은 안 죽어요. 다시 쓰일 뿐이죠."',
  '이제 알겠다. 이 책이 나를 다시 쓰고 있는 거다.\n몇 번이고. 이야기가 끝을 볼 때까지.',
];
const DEATH_LORE_LATER: string[] = [
  '익숙한 천장, 익숙한 부활.\n…익숙해진다는 게 조금 무섭다.',
  '이번엔 쓰러지는 소리까지 기억난다.\n점점 선명해진다. 끝이 가까워서일까.',
  '촌장이 말했다.\n"몇 번을 다시 쓰여도, 이야기는 앞으로만 간단다."',
];

export function getDeathLore(deaths: number): string {
  return deaths < DEATH_LORE.length
    ? DEATH_LORE[deaths]
    : DEATH_LORE_LATER[(deaths - DEATH_LORE.length) % DEATH_LORE_LATER.length];
}

export function townVisitScript(floorNo: number): TownNode[] {
  const tier = Math.floor(floorNo / 5);
  if (tier <= 1) return TOWN_VISIT_5;
  if (tier === 2) return TOWN_VISIT_10;
  if (tier === 3) return TOWN_VISIT_15;
  if (tier === 4) return TOWN_VISIT_20;
  return TOWN_VISIT_LATER;
}

// 죽음에서 돌아온 주인공을 맞이하는 마을 (부활 체크포인트).
// 1층이 아니라 마지막으로 다녀온 마을 층에서 다시 시작 — '주인공은 다시 쓰일 뿐' 세계관과 연결.
export function deathVisitScript(floorNo: number): TownNode[] {
  return [
    {
      kind: 'line',
      icon: '👧',
      speaker: '여관 소녀 니나',
      text: `또 눈을 떴네요, 모험가님! 놀라지 마요 — 여긴 ${floorNo}층 문으로 이어진 마을이에요. 당신은 몇 번이고 여기서 다시 시작할 수 있어요.`,
      next: 1,
    },
    {
      kind: 'line',
      icon: '👧',
      speaker: '니나',
      text: '전에 말했죠. "주인공은 안 죽어요. 다시 쓰일 뿐이죠." …상처는 제가 다 돌봐 뒀어요. 장비도 그대로고요.',
      next: 2,
    },
    {
      kind: 'line',
      icon: '👵',
      speaker: '촌장',
      text: `${floorNo}층까지 온 걸음이 헛되지 않았단다. 자, 다시 내려가 보렴 — 이번엔 조금 더 멀리.`,
      next: 3,
    },
    {
      kind: 'choice',
      prompt: `${floorNo}층 문 앞에 다시 섰다. 몸이 개운하다.`,
      options: [{ label: '⚔️ 던전으로 돌아간다', action: 'return' }],
    },
  ];
}

// ── 걸어다니는 마을(TownScene)에서 NPC에게 다가가 나누는 대화 ──
// 상황: 'enter'(던전 입장 전 허브) / 'visit'(5층마다 마을 문) / 'death'(부활 체크포인트)
// line 노드의 next가 음수면 대화 종료(마을로 복귀).
export type TownContext = 'enter' | 'visit' | 'death';

// 촌장 — 퀘스트·세계관. 깊이(층) 방문마다 진실에 한 걸음씩 다가간다.
export function chiefTalk(ctx: TownContext, firstTime: boolean, floorNo: number): TownNode[] {
  const L = (text: string, next: number): TownNode => ({ kind: 'line', icon: '👵', speaker: '촌장', text, next });
  if (ctx === 'death') {
    return [L(`${floorNo}층까지 온 걸음이 헛되지 않았단다. 다시 내려가 보렴 — 이번엔 조금 더 멀리.`, -1)];
  }
  if (ctx === 'visit') {
    const tier = Math.floor(floorNo / 5);
    if (tier <= 1)
      return [
        L("정말 던전 안의 문으로 나왔구먼! '다섯 층마다 책갈피가 꽂힌다'는 옛말이 사실이었어.", 1),
        L('책갈피가 무슨 뜻이냐고? 누군가 어디까지 읽었는지 표시해 두는 것 같지 않니?', -1),
      ];
    if (tier === 2)
      return [
        L('이 마을엔 아이가 태어나지 않아. 아무도 늙지도 않지. …이상하지? 근데 아무도 이상해하질 않아.', 1),
        L('나도 방금 처음으로 이상하다고 생각했네. 네가 온 뒤로, 멈춰 있던 것들이 조금씩 움직이는구나.', -1),
      ];
    if (tier === 3)
      return [
        L('보물이 기억을 되돌려준다는 얘기, 들었지. 이 던전은 잔인한 건지 다정한 건지 모르겠단 말이야.', 1),
        L('기억을 잘 붙들고 있으렴. 여기선 그게 제일 쉽게 사라지는 것이거든.', -1),
      ];
    if (tier === 4)
      return [
        L('…20층. 여기까지 온 사람에게는 말해 주기로 정해 뒀단다.', 1),
        L("나는 이 책을 '읽다가' 떨어진 게 아니야. 이 책을 '쓰던' 사람이란다. 마지막 장이 안 써져서… 이야기 안에 갇혔지.", 2),
        L('네가 한 층 내려갈 때마다 벽에 문장이 하나씩 늘어. 네 모험이 마지막 장을 대신 쓰고 있는 거야. …부디, 좋은 결말이 되어 다오.', -1),
      ];
    return [L('얼마 안 남았구나. 100층의 문은 이 책의 뒤표지란다. 좋은 결말을 부탁한다.', -1)];
  }
  // enter
  if (firstTime) {
    return [
      L('오, 또 떨어졌구먼! 2026년에서 왔다고? 쯧쯧, 집에 가고 싶겠지.', 1),
      L('마을 뒤 백층 던전, 그 가장 깊은 곳에 「집으로 가는 문」이 있단다. 끝까지 간 사람은… 음, 아직 없지만!', 2),
      L('던전 보물상자는 시험을 걸어와. 두 문의 수수께끼를 풀거나, 겁 없으면 몬스터를 상대해도 되지. 준비되면 저 던전 입구로 가렴.', -1),
    ];
  }
  return [L('왔구먼! 던전이 오늘도 입을 벌리고 기다린다. 준비되면 저 입구로 가렴.', -1)];
}

// 여관 소녀 니나 — 수프로 회복. 부활 직후엔 '죽지 않는다'는 진실을 넌지시.
export function ninaTalk(ctx: TownContext): TownNode[] {
  if (ctx === 'death') {
    return [
      { kind: 'line', icon: '👧', speaker: '여관 소녀 니나', text: '또 눈을 떴네요! 놀라지 마요 — 전에 말했잖아요. "주인공은 안 죽어요. 다시 쓰일 뿐이죠."', next: 1 },
      { kind: 'line', icon: '👧', speaker: '니나', text: '상처는 제가 다 돌봐 뒀어요. 특제 수프도 한 그릇 — 몸이 개운해질 거예요!', next: -1, gift: 'heal' },
    ];
  }
  return [
    { kind: 'line', icon: '👧', speaker: '여관 소녀 니나', text: '모험가님! 얼굴이 반쪽이 됐어요. 우리 여관 특제 수프 드시고 가요. 서비스예요!', next: -1, gift: 'heal' },
  ];
}

// 대장장이 무크 — 대화 끝에 강화 상점(대장간)을 연다.
export function mukTalk(): TownNode[] {
  return [
    { kind: 'line', icon: '🧔', speaker: '대장장이 무크', text: '오, 잠옷 모험가! 죽어도 몸에 남는 단련이 있지. 코인만 있으면 몇 번이고 벼려 주마.', next: 1 },
    {
      kind: 'choice',
      prompt: '무크의 손은 쇳가루가 아니라… 잉크로 얼룩져 있었다.',
      options: [
        { label: '🛠️ 대장간 — 영구 강화 (🪙)', action: 'shop' },
        { label: '↩️ 다음에 올게', action: 'close' },
      ],
    },
  ];
}

// 던전 입구 아치 — 상황별 내려가기. 첫 입장/허브에선 난이도(모드)를 고른다.
export function entranceOptions(ctx: TownContext, floorNo: number): TownNode[] {
  if (ctx === 'enter') {
    return [
      {
        kind: 'choice',
        prompt: '던전 입구다. 어두운 계단이 아래로 이어진다. 어느 쪽 시험을 택할까?',
        options: [
          { label: '🎒 초등학교 던전 (쉬운 문제)', action: 'enter', mode: 'kids' },
          { label: '🧠 어른 던전 (어려운 문제)', action: 'enter', mode: 'adult' },
          { label: '👹 몬스터 던전 (문제 대신 전투)', action: 'enter', mode: 'monster' },
          { label: '🕯️ 아직 준비가…', action: 'close' },
        ],
      },
    ];
  }
  // visit / death — 하던 도전을 이어서 내려간다
  return [
    {
      kind: 'choice',
      prompt: `던전 입구다. ${floorNo}층으로 이어진 계단이 기다린다.`,
      options: [
        { label: `⚔️ 던전으로 내려간다 (${floorNo}층)`, action: 'return' },
        { label: '🕯️ 마을을 더 둘러본다', action: 'close' },
      ],
    },
  ];
}

// ── 보물을 얻을 때 하나씩 돌아오는 집의 기억 (순서대로, 다 보면 순환)
export interface Memory {
  icon: string;
  title: string;
  text: string;
}

export const MEMORIES: Memory[] = [
  {
    icon: '🍜',
    title: '그때 그 라면',
    text: '시험 마지막 날, 편의점 앞 야외 테이블에서 먹던 컵라면. 국물 한 모금에 세상을 다 가진 기분이었지.\n…그때 옆에서 훈수 두던 녀석, 잘 있으려나.',
  },
  {
    icon: '👾',
    title: '밤샘의 맛',
    text: "밤새 게임하고 아침 해가 뜨는 걸 보며 '아, 망했다' 하고 웃던 방학.\n이상하게 그 '망했다'가 그립다.",
  },
  {
    icon: '✈️',
    title: '가족 여행',
    text: "부모님과 간 제주도. 아빠는 길을 잃고도 '이게 다 여행이지' 하셨다.\n엄마는 그 옆에서 몰래 내 사진만 찍고 계셨고.",
  },
  {
    icon: '🎒',
    title: '대학 MT',
    text: '장기자랑. 나는 분명 하기 싫다고 했는데, 정신을 차려 보니 무대 한가운데였다.\n…그 영상, 아직도 단톡방에 있다.',
  },
  {
    icon: '💘',
    title: '도서관의 그 사람',
    text: '3열람실, 같은 책을 집으려다 손이 닿았던 사람. 결국 말 한마디 못 걸었지만…\n잠깐. 그때 그 책 제목이, 『백층 던전의 비밀』이었던가?',
  },
  {
    icon: '🐕',
    title: '우리 집 강아지',
    text: '산책만 나가면 세상에서 제일 바빠지는 우리 집 강아지.\n지금쯤 내 방문 앞에 엎드려 기다리고 있을 텐데.',
  },
  {
    icon: '☕',
    title: '카페 알바',
    text: "마감 후에 사장님이 슬쩍 챙겨 주던 샌드위치. '남은 거야'라고 하셨지만,\n늘 갓 만든 것처럼 따뜻했다.",
  },
  {
    icon: '🎂',
    title: '생일 아침',
    text: '생일 아침의 미역국 냄새. 자취를 시작하고 나서야 알았다.\n그 냄새가 알람보다 먼저 나를 깨우고 있었다는 걸.',
  },
  {
    icon: '❄️',
    title: '첫눈 등굣길',
    text: '첫눈 오던 날, 아무도 밟지 않은 눈을 일부러 뽀득뽀득 밟으며 걸었다.\n지각했지만, 후회는 없다.',
  },
  {
    icon: '🌸',
    title: '벚꽃 캠퍼스',
    text: '벚꽃 흩날리던 캠퍼스에서 과잠 입고 단체사진.\n다들 어색하게 브이를 그렸지. 나도 그랬고.',
  },
  {
    icon: '📱',
    title: '새벽 두 시의 단톡방',
    text: "'자냐?' '아니' '나도'\n용건은 없었다. 그게 좋았다.",
  },
  {
    icon: '🏠',
    title: '현관문 소리',
    text: "현관문 비밀번호 누르는 소리, 그리고 '왔어?' 하는 목소리.\n세상에서 가장 평범하고, 가장 돌아가고 싶은 소리.",
  },
];

// ── 층을 내려갈 때 벽에서 발견하는 글귀 (도착한 층 번호 기준)
// 얕은 층은 실없고, 깊어질수록 진중해지며 던전의 정체에 대한 힌트가 된다.
const LORE_BY_FLOOR: Record<number, string> = {
  2: '「1층 주민 씀: 이 층 몬스터는 순한 편. 발로 툭 치면 도망감. 귀여움.」\n…아래층 소개를 벽에 써 두다니, 친절한 던전이네.',
  3: '「라면이 그립다.」\n…잠깐, 이거 한국어잖아. 나 말고도 온 사람이 있다.',
  4: '「숫자를 두려워하지 마라. 문은 아는 자에게만 열린다.」\n두 문의 시험 이야기인가.',
  5: '「다섯 층마다 종이 울리고 마을로 가는 문이 나타난다. 누가 만들었는지는 아무도 모른다. 고마우니까 안 물어보기로 했다.」',
  6: "「이 던전은 파낸 것이 아니다. '쓰인' 것이다.」\n…쓰였다니, 뭘로? 잉크로?",
  7: '「나는 1987년에서 왔다. 너는 몇 년도에서 왔나?」\n벽 곳곳에 연도들이 새겨져 있다. 1962… 1999… 2014…',
  8: '「몬스터를 미워하지 마라. 그들은 페이지를 지키는 문지기일 뿐이다.」',
  9: '「책을 읽다가 잠들지 마라.」\n…이제 와서 그런 말을 벽에 써 봐야.',
  10: '여기서부터 벽의 글씨가 젖어 있다. 잉크가 아직 마르지 않았다.\n이 아래는 아직 "쓰이는 중"이라는 뜻일까.',
  11: '「꿈이 아니다. 꼬집어 봤자 아프기만 하다. 내가 해 봤다.」',
  12: '「시간의 틈이라는 학설도 있다. 하지만 틈이라기엔… 너무 정성스럽다.」',
  13: '「마을에 아이가 없다는 걸 눈치챘나? 아무도 늙지도 않는다.」',
  14: '「촌장은 모든 것을 알고 있다. 다만 말할 때를 기다릴 뿐.」',
  15: '「내려갈수록 강해지는 것은 너만이 아니다. 이야기도 절정을 향해 가고 있으니까.」',
  16: "「돌아간 사람은 있다. 다만 '끝까지 읽은' 사람이 없을 뿐.」\n…읽는다고? 내려간다가 아니라?",
  17: '「56층에서 소녀를 만났다. 자기는 등장인물이라고 했다. 그래서 뭐 어떠냐고, 웃으면서.」',
  18: '「이 벽의 글은 누가 지우는 걸까. 어제 쓴 문장이 오늘은 없다.」',
  19: '「100층의 문은 문이 아니다. 표지다.」\n…뒤표지?',
  20: '「작가는 마지막 장을 쓰지 못했다. 그래서 우리가 여기에 있다.」',
  21: '「네 걸음이 문장이 된다. 부디, 좋은 이야기가 되기를.」',
};

const LORE_GENERIC: string[] = [
  '「아직 읽는 중인가? 대단한 끈기다.」',
  '「이 아래의 일은 우리도 모른다. 네가 처음이다.」',
  '「잉크 냄새가 짙어진다.」',
  '「몬스터들이 너를 두려워하기 시작했다.」',
  '「집에 돌아가면, 이 책을 끝까지 읽어 주겠나.」',
  '「…….」\n아무것도 쓰여 있지 않다. 이 던전에서, 처음 있는 일이다.',
];

export function getLore(floorNo: number): string {
  return LORE_BY_FLOOR[floorNo] ?? LORE_GENERIC[(floorNo * 7 + 3) % LORE_GENERIC.length];
}
