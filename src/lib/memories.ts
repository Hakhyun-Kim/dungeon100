// 되찾는 기억 — 보물을 얻을 때마다 2026년 한국의 기억이 하나씩 돌아온다.
// 기억은 네 갈래(일상·학교·집·사랑)로 나뉘고, **한 갈래를 다 모으면 특별한 능력**이 깨어난다.
// 기억은 판을 넘어 남으므로(localStorage) 대장간 코인과 함께 '메타 성장'의 한 축이다.
//
// 설계 원칙: 순수 데이터 + 순수 함수. 능력 효과는 powersOf()가 계산하고,
// 실제 적용은 App/씬이 담당한다 (검증·시뮬레이션이 쉬워지도록).

export type MemorySetId = 'daily' | 'school' | 'home' | 'love';

export interface MemorySetDef {
  id: MemorySetId;
  icon: string;
  name: string;
  /** 갈래의 정서 — 완성 화면에서 보여 준다 */
  desc: string;
  /** 완성 시 깨어나는 능력 */
  power: { icon: string; name: string; desc: string };
}

export const MEMORY_SETS: Record<MemorySetId, MemorySetDef> = {
  daily: {
    id: 'daily',
    icon: '☕',
    name: '사소한 날들',
    desc: '라면 한 그릇, 밤샘, 알바, 용건 없는 단톡방 — 별것 아니라 여겼던 것들.',
    power: {
      icon: '🍜',
      name: '사소한 것들의 힘',
      desc: '새 층에 도착할 때마다 체력 +6 (별것 아닌 것들이 나를 버티게 한다)',
    },
  },
  school: {
    id: 'school',
    icon: '🎓',
    name: '교정의 계절',
    desc: 'MT, 첫눈, 벚꽃, 그리고 억울한 조별 과제 — 다시 오지 않을 계절.',
    power: {
      icon: '📝',
      name: '벼락치기',
      desc: '두 문 달리기에서 틀려도 아이템 1개는 건진다 (망쳐도 학점은 건지던 그 감각)',
    },
  },
  home: {
    id: 'home',
    icon: '🏠',
    name: '돌아갈 집',
    desc: '가족 여행, 강아지, 미역국, 현관문 소리 — 늘 거기 있던 것들.',
    power: {
      icon: '🚪',
      name: '돌아갈 곳',
      desc: '한 판에 한 번, 쓰러져도 체력 40%로 다시 일어난다 (기다리는 사람이 있으니까)',
    },
  },
  love: {
    id: 'love',
    icon: '💗',
    name: '말하지 못한 마음',
    desc: '도서관, 우산, 접힌 페이지, 보내지 못한 메시지 — 끝내 전하지 못한 것들.',
    power: {
      icon: '💓',
      name: '두근거림',
      desc: '체력이 30% 아래일 때 공격력 +30% (심장이 뛰면, 아직 끝난 게 아니다)',
    },
  },
};

export interface Memory {
  id: string;
  set: MemorySetId;
  icon: string;
  title: string;
  text: string;
}

// 회수 순서 = 배열 순서. 갈래가 번갈아 나오도록 섞어 두어
// '사소한 날들'이 먼저 완성되고, '말하지 못한 마음'이 마지막에 완성된다 (감정의 정점).
export const MEMORIES: Memory[] = [
  {
    id: 'ramen',
    set: 'daily',
    icon: '🍜',
    title: '그때 그 라면',
    text: '시험 마지막 날, 편의점 앞 야외 테이블에서 먹던 컵라면. 국물 한 모금에 세상을 다 가진 기분이었지.\n…그때 옆에서 훈수 두던 녀석, 잘 있으려나.',
  },
  {
    id: 'mt',
    set: 'school',
    icon: '🎒',
    title: '대학 MT',
    text: '장기자랑. 나는 분명 하기 싫다고 했는데, 정신을 차려 보니 무대 한가운데였다.\n…그 영상, 아직도 단톡방에 있다.',
  },
  {
    id: 'trip',
    set: 'home',
    icon: '✈️',
    title: '가족 여행',
    text: "부모님과 간 제주도. 아빠는 길을 잃고도 '이게 다 여행이지' 하셨다.\n엄마는 그 옆에서 몰래 내 사진만 찍고 계셨고.",
  },
  {
    id: 'allnight',
    set: 'daily',
    icon: '👾',
    title: '밤샘의 맛',
    text: "밤새 게임하고 아침 해가 뜨는 걸 보며 '아, 망했다' 하고 웃던 방학.\n이상하게 그 '망했다'가 그립다.",
  },
  {
    id: 'library',
    set: 'love',
    icon: '💘',
    title: '도서관의 그 사람',
    text: '3열람실, 같은 책을 집으려다 손이 닿았던 사람. 결국 말 한마디 못 걸었지만…\n잠깐. 그때 그 책 제목이, 『백층 던전의 비밀』이었던가?',
  },
  {
    id: 'dog',
    set: 'home',
    icon: '🐕',
    title: '우리 집 강아지',
    text: '산책만 나가면 세상에서 제일 바빠지는 우리 집 강아지.\n지금쯤 내 방문 앞에 엎드려 기다리고 있을 텐데.',
  },
  {
    id: 'cafe',
    set: 'daily',
    icon: '☕',
    title: '카페 알바',
    text: "마감 후에 사장님이 슬쩍 챙겨 주던 샌드위치. '남은 거야'라고 하셨지만,\n늘 갓 만든 것처럼 따뜻했다.",
  },
  {
    id: 'snow',
    set: 'school',
    icon: '❄️',
    title: '첫눈 등굣길',
    text: '첫눈 오던 날, 아무도 밟지 않은 눈을 일부러 뽀득뽀득 밟으며 걸었다.\n지각했지만, 후회는 없다.',
  },
  {
    id: 'chat',
    set: 'daily',
    icon: '📱',
    title: '새벽 두 시의 단톡방',
    text: "'자냐?' '아니' '나도'\n용건은 없었다. 그게 좋았다.",
  },
  {
    id: 'birthday',
    set: 'home',
    icon: '🎂',
    title: '생일 아침',
    text: '생일 아침의 미역국 냄새. 자취를 시작하고 나서야 알았다.\n그 냄새가 알람보다 먼저 나를 깨우고 있었다는 걸.',
  },
  {
    id: 'blossom',
    set: 'school',
    icon: '🌸',
    title: '벚꽃 캠퍼스',
    text: '벚꽃 흩날리던 캠퍼스에서 과잠 입고 단체사진.\n다들 어색하게 브이를 그렸지. 나도 그랬고.',
  },
  {
    id: 'umbrella',
    set: 'love',
    icon: '☔',
    title: '하나뿐인 우산',
    text: '갑자기 쏟아진 비. 우산은 하나였고, 우리는 둘이었다.\n한쪽 어깨가 다 젖는 줄도 몰랐다. 아니, 알면서 모른 척했다.',
  },
  {
    id: 'team',
    set: 'school',
    icon: '📝',
    title: '조별 과제',
    text: '이름만 올린 사람이 셋. 발표는 결국 내가 했다.\n억울했는데… 지금 생각하면 그것도 웃긴 이야기다.',
  },
  {
    id: 'door',
    set: 'home',
    icon: '🏠',
    title: '현관문 소리',
    text: "현관문 비밀번호 누르는 소리, 그리고 '왔어?' 하는 목소리.\n세상에서 가장 평범하고, 가장 돌아가고 싶은 소리.",
  },
  {
    id: 'page',
    set: 'love',
    icon: '📖',
    title: '접힌 페이지',
    text: '그 사람이 빌려준 책. 한 페이지만 귀퉁이가 접혀 있었다.\n무슨 뜻이냐고 끝내 묻지 못했다.\n\n…설마, 그 페이지가 여기였을까.',
  },
  {
    id: 'message',
    set: 'love',
    icon: '💬',
    title: '보내지 못한 메시지',
    text: "새벽 세 시. 썼다 지웠다 한 문장 하나.\n'사실 나는—'\n\n결국 보내지 않았다. 아직 임시보관함에 있다.\n돌아가면, 이번엔 보낼 수 있을까.",
  },
];

export const memoryById = (id: string) => MEMORIES.find((m) => m.id === id);
export const setSize = (set: MemorySetId) => MEMORIES.filter((m) => m.set === set).length;

// 아직 회수하지 않은 다음 기억 (순서대로)
export function nextMemory(collected: string[]): Memory | null {
  return MEMORIES.find((m) => !collected.includes(m.id)) ?? null;
}

export interface SetProgress {
  set: MemorySetDef;
  have: number;
  total: number;
  done: boolean;
}

export function setProgress(collected: string[]): SetProgress[] {
  return (Object.keys(MEMORY_SETS) as MemorySetId[]).map((id) => {
    const total = setSize(id);
    const have = MEMORIES.filter((m) => m.set === id && collected.includes(m.id)).length;
    return { set: MEMORY_SETS[id], have, total, done: have >= total };
  });
}

export const completedSets = (collected: string[]): MemorySetId[] =>
  setProgress(collected)
    .filter((p) => p.done)
    .map((p) => p.set.id);

// 이번에 새로 완성된 갈래 (기억 하나를 회수한 직후 호출)
export function newlyCompletedSet(before: string[], after: string[]): MemorySetId | null {
  const was = new Set(completedSets(before));
  return completedSets(after).find((id) => !was.has(id)) ?? null;
}

// ── 능력 — 완성한 갈래에서 계산되는 순수 결과. 적용은 App/씬이 한다.
export interface MemoryPowers {
  /** 사소한 것들의 힘 — 새 층 도착 시 회복량 (0이면 없음) */
  floorHeal: number;
  /** 벼락치기 — 두 문 달리기 실패 시에도 아이템 1개 */
  consolation: boolean;
  /** 돌아갈 곳 — 판당 1회 부활 */
  revive: boolean;
  /** 두근거림 — 저체력(30% 미만) 공격력 배율 (1이면 없음) */
  desperateMul: number;
  /** 기억의 완성 — 시작 최대 체력 보너스 */
  bonusMaxHp: number;
}

export function powersOf(collected: string[]): MemoryPowers {
  const done = new Set(completedSets(collected));
  const all = done.size === Object.keys(MEMORY_SETS).length;
  return {
    floorHeal: done.has('daily') ? 6 : 0,
    consolation: done.has('school'),
    revive: done.has('home'),
    desperateMul: done.has('love') ? 1.3 : 1,
    bonusMaxHp: all ? 30 : 0,
  };
}

// 예전 저장 방식(개수만 저장하던 d100-mem) → 새 방식(회수한 기억 id 목록)으로 변환
export const migrateCount = (count: number): string[] =>
  MEMORIES.slice(0, Math.max(0, Math.min(MEMORIES.length, count))).map((m) => m.id);
