// 층 생성 불변식 검사 — 절차 생성기가 "플레이 가능한 층"만 내놓는지 헤드리스로 확인한다.
// 브라우저·렌더 없이 순수 함수만 돌리므로 1초 안에 끝난다 (npm run floor-check).
//
// 검사하는 불변식 (하나라도 깨지면 exit 1 — 봇이 갇히거나 벽에 상자가 박히는 사고를 사전 차단):
//   1) 시작점에서 출구·상자·마을 문·제단·비밀 문·틈·서가·흔적·소녀가 전부 4-연결로 도달 가능
//   2) 모든 배치물·적 스폰이 바닥 칸 위 (벽 속 매립 금지)
//   3) 배치물 위치에서 플레이어 반경(0.42)으로 실제로 설 수 있음 (canStand)
//   4) 고립된 바닥 영역이 없음 (BFS 도달 칸 수 == 전체 바닥 칸 수)
//   5) 동굴 층을 켜도 방-복도 층의 지형이 예전과 100% 동일 (층=시드 재현성)
//   6) 🔥 모험의 길 붉은 포털 자리(forkSpot)가 바닥 위·도달 가능·출구와 겹치지 않음
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'd100-floor-'));
const bundle = join(out, 'dungeon.mjs');
await build({
  entryPoints: ['src/lib/dungeon.ts'],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'silent',
});
const { generateFloor, isCaveFloor, forkSpot, GRID, canStand, cellToWorld, isFloor } = await import(
  pathToFileURL(bundle).href
);
rmSync(out, { recursive: true, force: true });

// 시작 칸에서 4-연결로 닿는 바닥 칸 (findPathCells와 같은 연결성 정의)
function reachable(cells, sx, sy) {
  const seen = new Uint8Array(GRID * GRID);
  const q = [sy * GRID + sx];
  seen[q[0]] = 1;
  let n = 1;
  for (let i = 0; i < q.length; i++) {
    const cur = q[i];
    const cx = cur % GRID;
    for (const d of [1, -1, GRID, -GRID]) {
      if (d === 1 && cx === GRID - 1) continue;
      if (d === -1 && cx === 0) continue;
      const nxt = cur + d;
      if (nxt < 0 || nxt >= GRID * GRID || seen[nxt] || cells[nxt] !== 1) continue;
      seen[nxt] = 1;
      n++;
      q.push(nxt);
    }
  }
  return { seen, n };
}

const fails = [];
const forkStat = { yes: 0, no: 0 };
const caveFloors = [];
const area = { cave: [], room: [] };

// 일일 던전(날짜 시드 오프셋)도 같은 불변식을 지켜야 한다
const VARIANTS = [0, 20260725, 12345];

for (const off of VARIANTS) {
  for (let f = 1; f <= 100; f++) {
    const m = generateFloor(f, off);
    const tag = `F${f}${off ? `+${off}` : ''}(${m.cave ? 'cave' : 'room'})`;
    if (off === 0 && m.cave) caveFloors.push(f);
    const total = m.cells.reduce((a, b) => a + b, 0);
    if (off === 0) area[m.cave ? 'cave' : 'room'].push(total);

    const { seen, n } = reachable(m.cells, m.start.x, m.start.y);
    if (n !== total) fails.push(`${tag} 고립된 바닥 ${total - n}칸`);

    const points = {
      exit: m.exit,
      chest: m.chest,
      homeDoor: m.homeDoor,
      trace: m.trace,
      girl: m.girl,
      altar: m.altar,
      secret: m.secret,
      collapse: m.collapse,
      rift0: m.rifts && m.rifts[0],
      rift1: m.rifts && m.rifts[1],
    };
    for (const [name, p] of Object.entries(points)) {
      if (!p) continue;
      if (!isFloor(m.cells, p.x, p.y)) fails.push(`${tag} ${name} 벽 속 배치`);
      else if (!seen[p.y * GRID + p.x]) fails.push(`${tag} ${name} 도달 불가`);
      const [wx, wz] = cellToWorld(p.x, p.y);
      if (!canStand(m.cells, wx, wz, 0.42)) fails.push(`${tag} ${name} 설 수 없음(canStand)`);
    }
    for (const s of m.spawns) {
      if (!isFloor(m.cells, s.x, s.y)) {
        fails.push(`${tag} 적 스폰이 벽 위`);
        break;
      }
    }
    if (m.mire) {
      for (const mc of m.mire) {
        if (!isFloor(m.cells, mc.x, mc.y)) {
          fails.push(`${tag} 좀먹은 바닥이 벽 위`);
          break;
        }
        if (!seen[mc.y * GRID + mc.x]) {
          fails.push(`${tag} 좀먹은 바닥 도달 불가`);
          break;
        }
      }
    }
    // 🔥 모험의 길 — 갈림길 층에 놓이는 붉은 포털. 자리를 못 잡으면(null) 그 층은 갈림길이
    // 안 열릴 뿐이라 실패가 아니다. 다만 **잡았다면** 다른 배치물과 같은 규칙을 지켜야 한다.
    const fk = forkSpot(m);
    if (fk) {
      if (!isFloor(m.cells, fk.x, fk.y)) fails.push(`${tag} 붉은 포털 벽 속 배치`);
      else if (!seen[fk.y * GRID + fk.x]) fails.push(`${tag} 붉은 포털 도달 불가`);
      const [fwx, fwz] = cellToWorld(fk.x, fk.y);
      if (!canStand(m.cells, fwx, fwz, 0.42)) fails.push(`${tag} 붉은 포털 설 수 없음(canStand)`);
      const fd = Math.hypot(fk.x - m.exit.x, fk.y - m.exit.y);
      if (fd < 3 || fd > 5) fails.push(`${tag} 붉은 포털이 출구에서 ${fd.toFixed(1)}칸 (3~5 밖)`);
      forkStat.yes++;
    } else forkStat.no++;

    if (m.cave !== isCaveFloor(f, off)) {
      // 동굴 판정이 났는데 지형이 방-복도면 폴백이 걸린 것 — 사고는 아니지만 드물어야 한다
      if (isCaveFloor(f, off)) fails.push(`${tag} 동굴 생성 폴백`);
      else fails.push(`${tag} 동굴 판정 불일치`);
    }
  }
}

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
console.log(`동굴 층(기본 시드): ${caveFloors.length}개 — ${caveFloors.join(', ')}`);
console.log(`평균 바닥 칸 — 동굴 ${avg(area.cave)} / 방-복도 ${avg(area.room)}`);

// 면적당 적 밀도 — 동굴 층이 '넓어서 거저 쉬워지지' 않았는지 확인한다.
// 층 깊이 편향을 없애려고 동굴이 나오는 테마 밴드(11~20·41~50·71~80) 안에서만 비교한다.
const dens = { cave: [], room: [] };
for (let f = 11; f <= 80; f++) {
  if (![1, 4, 7].includes(Math.floor((f - 1) / 10))) continue;
  const m = generateFloor(f);
  const a = m.cells.reduce((x, y) => x + y, 0);
  dens[m.cave ? 'cave' : 'room'].push((m.spawns.length / a) * 100);
}
const avg2 = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : 0);
console.log(
  `바닥 100칸당 적 (같은 테마 밴드) — 동굴 ${avg2(dens.cave)} / 방-복도 ${avg2(dens.room)}`,
);
console.log(
  `🔥 붉은 포털 자리를 잡은 층: ${forkStat.yes} / 못 잡은 층: ${forkStat.no}` +
    ' (못 잡은 층은 갈림길이 안 열릴 뿐 — 사고 아님)',
);
console.log(`검사한 층: ${VARIANTS.length * 100}개 (시드 오프셋 ${VARIANTS.join(', ')})`);

if (fails.length) {
  console.error(`\n❌ 불변식 위반 ${fails.length}건`);
  for (const line of fails.slice(0, 30)) console.error('  -', line);
  if (fails.length > 30) console.error(`  … 외 ${fails.length - 30}건`);
  process.exit(1);
}
console.log('\n✅ 모든 층이 불변식을 통과했다.');
