// 개발 일지 데이터 생성 — git log --numstat 를 분석해 public/journal.html 의
// [journal-data] 블록(days/ledgerAll/cum)을 다시 쓴다.
// milestones(수동 좌표 라벨)·categories(수동 분류)는 건드리지 않는다 — 대신 참고용
// 카테고리 키워드 집계를 출력하니, 큰 작업 뒤엔 milestones에 새 점을 눈으로 추가할 것.
// 사용: npm run journal-data → git diff 로 확인 후 커밋
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/journal.html';

// ── git log 파싱 (커밋 순서 = 오래된 것부터)
const raw = execSync('git log --reverse --date=format:%m-%d --pretty=@%H%x09%ad%x09%s --numstat', {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const commits = [];
let cur = null;
for (const line of raw.split('\n')) {
  if (line.startsWith('@')) {
    const [, date, subject] = line.slice(1).split('\t');
    cur = { date, subject: subject ?? '', ins: 0, del: 0 };
    commits.push(cur);
  } else if (cur && /^(\d+|-)\t(\d+|-)\t/.test(line)) {
    const [i, d] = line.split('\t');
    if (i !== '-') cur.ins += +i;
    if (d !== '-') cur.del += +d;
  }
}
if (!commits.length) throw new Error('git log가 비어 있음');

// ── 일별 집계 (커밋 있는 날만) + 커밋별 순증 누적
const byDay = [];
for (const c of commits) {
  const last = byDay[byDay.length - 1];
  if (last && last.date === c.date) {
    last.commits++;
    last.ins += c.ins;
    last.del += c.del;
  } else {
    byDay.push({ date: c.date, commits: 1, ins: c.ins, del: c.del });
  }
}
const day1 = byDay[0];
const days = byDay.slice(1);
const cum = [];
let total = 0;
for (const c of commits) {
  total += c.ins - c.del;
  cum.push(total);
}

// ── [journal-data] 블록 재작성
const dayLine = (d) => `    { date: '${d.date}', commits: ${d.commits}, ins: ${d.ins}, del: ${d.del} }`;
const block = [
  '  // [journal-data:start] — npm run journal-data 로 자동 생성 (수동 편집 금지)',
  '  var days = [',
  days.map(dayLine).join(',\n'),
  '  ];',
  '  var ledgerAll = [',
  `    { date: '${day1.date}', commits: ${day1.commits}, ins: ${day1.ins}, del: ${day1.del}, day1: true },`,
  '  ].concat(days);',
  '',
  `  var cum = [${cum.join(',')}];`,
  '  // [journal-data:end]',
].join('\n');

let html = readFileSync(FILE, 'utf8');
const re = /  \/\/ \[journal-data:start\][\s\S]*?\/\/ \[journal-data:end\]/;
if (!re.test(html)) throw new Error(`${FILE}에서 [journal-data] 마커를 찾지 못함`);
html = html.replace(re, block);

// ── 상단 통계 타일·본문·메타의 파생 수치도 함께 (문맥을 앵커로 잡아 그 수치만 교체)
const first = byDay[0].date;
const last = byDay[byDay.length - 1].date;
const spanDays =
  Math.round((new Date(`2026-${last}`) - new Date(`2026-${first}`)) / 86400000) + 1;
const fmtNum = (n) => n.toLocaleString('en-US');
html = html
  .replace(
    /(<div class="stat-num mono">)\d+(<\/div>\s*<div class="stat-label">커밋<\/div>)/,
    `$1${commits.length}$2`,
  )
  .replace(/(<div class="stat-num mono">)\d+(<small>일<\/small>)/, `$1${spanDays}$2`)
  .replace(/(<div class="stat-label">2026-)[\d-]+ → [\d-]+(<\/div>)/, `$1${first} → ${last}$2`)
  .replace(
    /(<div class="stat-num mono">)\+[\d,]+(<\/div>\s*<div class="stat-label">순증가)/,
    `$1+${fmtNum(total)}$2`,
  )
  .replace(/\d+개 커밋을 성격별로/, `${commits.length}개 커밋을 성격별로`)
  .replace(/\(07-\d\d → 07-\d\d\)/, `(${first} → ${last})`);
writeFileSync(FILE, html);

console.log(`📗 ${FILE} 갱신 — 커밋 ${commits.length}개 · 활동일 ${byDay.length}일 · 누적 ${total.toLocaleString()}줄`);
console.log('⚠️ milestones는 수동 — 새 큰 작업이 있으면 idx(커밋 번호)를 눈으로 추가하세요.');

// ── 참고용: 커밋 메시지 키워드 분류 집계 (categories 갱신 판단 보조)
const CATS = [
  ['문서 정비', /문서|README|일지|DESIGN|기록/],
  ['전투·밸런스', /밸런스|난이도|램프|보스|위협|스탯/],
  ['게임플레이·코어', /던전|이벤트|포털|드래프트|진화|도감|아레나|기억/],
  ['자동화·검증', /시연|시뮬|봇|스모크|CI|검증|사서|회귀/],
  ['스토리·월드빌딩', /스토리|글귀|소녀|세계관|엔딩|대사/],
  ['그래픽·UI 품질', /그래픽|블룸|UI|연출|이펙트|텍스처|리빌/],
  ['모바일·입력', /모바일|조이스틱|가로|회전|터치/],
  ['버그 수정', /수정|버그|해소|방지/],
];
const tally = new Map(CATS.map(([n]) => [n, 0]));
let etc = 0;
for (const c of commits) {
  const hit = CATS.find(([, re2]) => re2.test(c.subject));
  if (hit) tally.set(hit[0], tally.get(hit[0]) + 1);
  else etc++;
}
console.log('\n카테고리 키워드 집계 (참고 — categories 배열은 수동 큐레이션):');
for (const [n, v] of tally) console.log(`  ${n}: ${v}`);
console.log(`  (미분류: ${etc})`);
