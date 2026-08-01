// 리소스 규칙 검사 — "절차 생성이 기본값"을 문서가 아니라 코드가 지키게 한다.
//
// 2026-07-27 규칙 완화로 라이선스가 허용하면 외부 리소스를 쓸 수 있게 됐다. 그래서 필요한 것은
// '금지'가 아니라 **원장 없는 반입 금지** — 런타임에 들어온 리소스·외부 호스트가 전부 원장
// (docs/assets.json)에 적혀 있는지 매번 대조한다. 규칙이 지켜지는 게 아니라 잊히는 걸 막는 장치.
//
// 원장은 **기계가 읽는 파일**(docs/assets.json)이 원본이고, 사람이 읽는 표(docs/ASSETS.md)는
// 그 생성물이다 — 손으로 쓴 표는 반드시 낡기 때문. 두 곳이 어긋나면 이 검사가 실패한다.
//
// 브라우저 없이 도는 순수 검사(floor-check와 같은 급).
//   npm run assets-check   검사만 (배포 게이트)
//   npm run assets-write   원장을 읽어 ASSETS.md의 표를 다시 씀
// 종료 코드 0 = 통과 / 1 = 위반.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LEDGER = 'docs/assets.json'; // 원본 (기계가 읽는다)
const DOC = 'docs/ASSETS.md'; // 생성물 (사람이 읽는다)
const WRITE = process.argv.includes('--write');

// 런타임 트리 — 빌드 결과에 실려 브라우저가 실제로 받는 것만 본다.
// (docs/screenshots·assets/ 썸네일은 직접 캡처한 문서용이고 게임이 로드하지 않는다)
const RUNTIME_DIRS = ['src', 'public'];
const RUNTIME_FILES = ['index.html'];

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico',
  '.mp3', '.ogg', '.wav', '.m4a', '.flac', '.aac',
  '.glb', '.gltf', '.fbx', '.obj', '.dae',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.mp4', '.webm', '.mov',
]);

// 네트워크 요청이 아닌 것 — XML 네임스페이스는 식별자일 뿐 로드가 아니다.
const NOT_A_LOAD = new Set(['www.w3.org']);

// 허용 라이선스 (공개 저장소 + Pages 배포 = 상업적 사용·재배포가 가능해야 한다)
const OK_LICENSE =
  /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|0BSD|CC0-1\.0|Unlicense|OFL-1\.1|MIT-0|Python-2\.0|BlueOak-1\.0\.0)$/;

const fails = [];
const notes = [];

// ── 원장 읽기
function readLedger() {
  const p = join(ROOT, LEDGER);
  if (!existsSync(p)) {
    fails.push(`원장 ${LEDGER} 이 없다 — 외부 리소스를 쓰려면 출처·라이선스를 적을 곳이 먼저 있어야 한다.`);
    return { hosts: [], files: [] };
  }
  const j = JSON.parse(readFileSync(p, 'utf8'));
  for (const h of j.hosts ?? []) {
    for (const k of ['host', 'use', 'license', 'source', 'form']) {
      if (!h[k]) fails.push(`${LEDGER}: host ${h.host ?? '(이름 없음)'} 에 '${k}' 가 비었다.`);
    }
  }
  for (const f of j.files ?? []) {
    for (const k of ['path', 'use', 'license', 'source', 'why']) {
      // why = "절차 생성으로 대체할 수 없는 이유" — ③ 최후 수단이므로 근거를 강제한다
      if (!f[k]) fails.push(`${LEDGER}: file ${f.path ?? '(경로 없음)'} 에 '${k}' 가 비었다.`);
    }
  }
  return { hosts: j.hosts ?? [], files: j.files ?? [] };
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function runtimeFiles() {
  const out = [];
  for (const d of RUNTIME_DIRS) {
    const p = join(ROOT, d);
    if (existsSync(p)) walk(p, out);
  }
  for (const f of RUNTIME_FILES) {
    const p = join(ROOT, f);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

// ── ① 런타임에 들어온 바이너리 리소스가 원장에 있는가
function checkBinaries(files, ledger) {
  const allow = new Set(ledger.files.map((f) => f.path));
  const found = [];
  for (const p of files) {
    if (!BINARY_EXT.has(extname(p).toLowerCase())) continue;
    const rel = relative(ROOT, p).split(sep).join('/');
    found.push(rel);
    if (!allow.has(rel)) {
      fails.push(
        `런타임 리소스 파일이 원장에 없다: ${rel}\n` +
          `   → ${LEDGER} 의 files 에 {path, use, license, source, why} 를 추가할 것 ` +
          `(why = 절차 생성으로 대체할 수 없는 이유).`,
      );
    }
  }
  notes.push(
    `런타임 바이너리 리소스 ${found.length}개` + (found.length ? `: ${found.join(', ')}` : ' (전부 절차 생성)'),
  );
  for (const f of ledger.files) {
    if (!found.includes(f.path)) notes.push(`⚠️ 원장의 file ${f.path} 이 실제로 없다 (원장 정리 필요?)`);
  }
}

// ── ② 런타임 코드가 실제로 '로드'하는 외부 호스트가 원장에 있는가
// (하이퍼링크 <a href>·XML 네임스페이스는 로드가 아니므로 세지 않는다)
const LOAD_PATTERNS = [
  /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi,
  /<(?:script|img|source|audio|video|iframe)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi,
  /url\(\s*["']?([^"')]+)["']?\s*\)/gi,
  /@import\s+["']([^"']+)["']/gi,
  /\bfetch\(\s*["'`]([^"'`]+)["'`]/g,
  /\.src\s*=\s*["'`]([^"'`]+)["'`]/g,
];

function checkHosts(files, ledger) {
  const allow = new Set(ledger.hosts.map((h) => h.host));
  const seen = new Map(); // host → 참조한 파일들
  for (const p of files) {
    if (!['.html', '.css', '.ts', '.tsx', '.js', '.jsx'].includes(extname(p).toLowerCase())) continue;
    const src = readFileSync(p, 'utf8');
    const rel = relative(ROOT, p).split(sep).join('/');
    for (const re of LOAD_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        if (!/^https?:\/\//i.test(m[1])) continue; // 상대 경로·data:·blob: 은 자체 자원
        let host;
        try {
          host = new URL(m[1]).hostname;
        } catch {
          continue;
        }
        if (NOT_A_LOAD.has(host)) continue;
        if (!seen.has(host)) seen.set(host, new Set());
        seen.get(host).add(rel);
      }
    }
  }
  for (const [host, where] of seen) {
    if (!allow.has(host)) {
      fails.push(
        `원장에 없는 외부 호스트를 로드한다: ${host}  (${[...where].join(', ')})\n` +
          `   → 라이선스 게이트를 통과시킨 뒤 ${LEDGER} 의 hosts 에 {host, use, license, source, form, fallback} 추가.`,
      );
    }
  }
  notes.push(`외부 로드 호스트 ${seen.size}개` + (seen.size ? `: ${[...seen.keys()].join(', ')}` : ''));
  for (const h of allow) {
    if (!seen.has(h)) notes.push(`⚠️ 원장의 host ${h} 는 이제 어디서도 로드되지 않는다 (원장 정리 필요?)`);
  }
}

// ── ③ 직접 의존성 라이선스 (기억이 아니라 package.json 실측)
function collectLicenses() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const rows = [];
  for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const p = join(ROOT, 'node_modules', ...name.split('/'), 'package.json');
    if (!existsSync(p)) continue; // 미설치 — CI에서 install 전이면 건너뛴다
    const meta = JSON.parse(readFileSync(p, 'utf8'));
    const license = typeof meta.license === 'string' ? meta.license : meta.license?.type || '';
    const dev = !pkg.dependencies?.[name];
    rows.push({ name, version: meta.version, license, dev, range });
    if (!OK_LICENSE.test(license)) {
      fails.push(`의존성 라이선스가 허용 목록 밖: ${name}@${meta.version} = ${license || '(없음)'}`);
    }
  }
  notes.push(`직접 의존성 라이선스 ${rows.length}개 확인 (미설치는 건너뜀)`);
  return rows;
}

// ── ④ 사람이 읽는 문서의 표가 원장과 같은가 (--write 면 다시 쓴다)
const MARK_START = '<!-- assets-table:start -->';
const MARK_END = '<!-- assets-table:end -->';

function renderTables(ledger, libs) {
  const L = [];
  L.push('### 외부 호스트 (② 참조 — 저장소에 원본 파일 없음)', '');
  if (ledger.hosts.length) {
    L.push('| 호스트 | 용도 | 라이선스 | 출처 | 폴백 |', '|---|---|---|---|---|');
    for (const h of ledger.hosts) {
      L.push(`| \`${h.host}\` | ${h.use} | ${h.license} | [원본](${h.source}) | ${h.fallback ?? '—'} |`);
    }
  } else L.push('**없음.**');
  L.push('', '### 반입한 원본 파일 (③ 최후 수단)', '');
  if (ledger.files.length) {
    L.push('| 경로 | 용도 | 라이선스 | 출처 | 코드로 못 만드는 이유 |', '|---|---|---|---|---|');
    for (const f of ledger.files) {
      L.push(`| \`${f.path}\` | ${f.use} | ${f.license} | [원본](${f.source}) | ${f.why} |`);
    }
  } else {
    L.push('**없음 — 런타임 바이너리 리소스 0개.** 이미지·오디오·3D 모델이 하나도 없다는 뜻이고,');
    L.push('이 상태가 기본값이다. 줄이 늘어난다는 건 사다리 ③으로 내려갔다는 뜻이니 이유를 남긴다.');
  }
  L.push('', '### 오픈소스 라이브러리', '');
  L.push('| 패키지 | 버전 | 라이선스 | 용도 |', '|---|---|---|---|');
  for (const l of libs) {
    L.push(`| ${l.name} | ${l.version} | ${l.license} | ${l.dev ? '빌드·검증' : '런타임 번들'} |`);
  }
  return L.join('\n');
}

function syncDoc(ledger, libs) {
  const p = join(ROOT, DOC);
  if (!existsSync(p)) {
    fails.push(`${DOC} 가 없다.`);
    return;
  }
  const md = readFileSync(p, 'utf8');
  const i = md.indexOf(MARK_START);
  const j = md.indexOf(MARK_END);
  if (i < 0 || j < 0) {
    fails.push(`${DOC} 에 ${MARK_START} … ${MARK_END} 마커가 없다 (표를 넣을 자리).`);
    return;
  }
  const want = `${MARK_START}\n<!-- 이 아래는 docs/assets.json 에서 생성된다. 직접 고치지 말 것 — npm run assets-write -->\n\n${renderTables(ledger, libs)}\n\n${MARK_END}`;
  const have = md.slice(i, j + MARK_END.length);
  if (have === want) {
    notes.push(`${DOC} 표가 원장과 일치`);
    return;
  }
  if (WRITE) {
    writeFileSync(p, md.slice(0, i) + want + md.slice(j + MARK_END.length), 'utf8');
    notes.push(`${DOC} 표를 원장에서 다시 썼다`);
  } else {
    fails.push(`${DOC} 의 표가 원장(${LEDGER})과 어긋난다 — 'npm run assets-write' 로 다시 쓸 것.`);
  }
}

const ledger = readLedger();
const files = runtimeFiles();
checkBinaries(files, ledger);
checkHosts(files, ledger);
const libs = collectLicenses();
if (libs.length) syncDoc(ledger, libs); // 의존성 미설치면 표를 지우지 않도록 건너뛴다

console.log(`── 리소스 규칙 검사 (절차 생성이 기본값)${WRITE ? ' · 문서 갱신 모드' : ''} ──`);
for (const n of notes) console.log('  ·', n);
if (fails.length) {
  console.log('');
  for (const f of fails) console.log('❌', f);
  console.log(`\n📕 위반 ${fails.length}건 — 원장 ${LEDGER} 을 먼저 갱신할 것.`);
  process.exit(1);
}
console.log('\n📗 통과 — 런타임 리소스·외부 호스트·라이선스가 전부 원장과 일치한다.');
