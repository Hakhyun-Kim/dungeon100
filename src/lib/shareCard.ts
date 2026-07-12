// 게임 기록 공유 카드 — 캔버스로 그려 저장/공유 (파일·서버 없음)

export interface CardStats {
  floor: number;
  kills: number;
  mem: number;
  memMax: number;
  best: number;
  mode: 'kids' | 'adult';
  cleared?: boolean;
}

function drawCard(s: CardStats): HTMLCanvasElement {
  const W = 720;
  const H = 960;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;

  // 배경
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, s.cleared ? '#3d3418' : '#2c2050');
  bg.addColorStop(1, '#0d0918');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  // 별가루
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.12})`;
    x.beginPath();
    x.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 0, Math.PI * 2);
    x.fill();
  }

  const F = "'Jua', 'Malgun Gothic', sans-serif";
  x.textAlign = 'center';

  x.font = `44px ${F}`;
  x.fillStyle = '#c9b4ff';
  x.fillText('백층 던전', W / 2, 110);
  x.font = `24px ${F}`;
  x.fillStyle = '#9c8fc4';
  x.fillText(s.cleared ? '— 끝까지 읽은 사람 —' : '책 속으로 떨어진 대학생의 기록', W / 2, 156);

  x.font = `120px ${F}`;
  x.fillText(s.cleared ? '📖' : '🏰', W / 2, 320);

  x.font = `96px ${F}`;
  x.fillStyle = '#ffd166';
  x.fillText(s.cleared ? '100층 완주!' : `${s.floor}층`, W / 2, 470);
  if (!s.cleared) {
    x.font = `28px ${F}`;
    x.fillStyle = '#b9aede';
    x.fillText('…에서 페이지가 넘어갔다', W / 2, 520);
  }

  const rows: [string, string][] = [
    ['💀 처치', String(s.kills)],
    ['💭 되찾은 기억', `${Math.min(s.mem, s.memMax)} / ${s.memMax}`],
    ['🏆 최고 기록', `${Math.max(s.best, s.floor)}층`],
    ['🚪 던전', s.mode === 'kids' ? '🎒 초등학교' : '🧠 어른'],
  ];
  x.font = `30px ${F}`;
  rows.forEach(([label, val], i) => {
    const y = 610 + i * 62;
    x.textAlign = 'left';
    x.fillStyle = '#d8cff2';
    x.fillText(label, 130, y);
    x.textAlign = 'right';
    x.fillStyle = '#ffffff';
    x.fillText(val, W - 130, y);
  });

  x.textAlign = 'center';
  x.font = `24px ${F}`;
  x.fillStyle = '#8d7fc0';
  x.fillText('hakhyun-kim.github.io/dungeon100', W / 2, H - 60);

  return c;
}

// 공유(가능하면) 또는 PNG 다운로드
export async function shareCard(s: CardStats): Promise<'shared' | 'saved'> {
  const canvas = drawCard(s);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return 'saved';
  const file = new File([blob], `dungeon100-${s.cleared ? 'clear' : s.floor + 'f'}.png`, {
    type: 'image/png',
  });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '백층 던전' });
      return 'shared';
    }
  } catch {
    // 공유 취소/미지원 → 다운로드로
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'saved';
}
