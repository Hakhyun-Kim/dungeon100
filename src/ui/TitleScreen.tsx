import { useEffect, useRef } from 'react';
import type { DailyRecord } from '../lib/daily';
import { MEMORIES } from '../lib/memories';
import { ChoiceList } from './Menu';
import { SetProgressRow } from './LoreScreens';

// 타이틀 배경 — 떠오르는 잉크 먼지와 글자 조각 (캔버스 2D, 외부 에셋 없음)
const GLYPHS = ['백', '층', '던', '전', '책', '장', '글', '꿈'];

function TitleFx() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    fit();
    window.addEventListener('resize', fit);
    interface Mote {
      x: number; y: number; r: number; vy: number; vx: number; a: number;
      glyph: string | null; rot: number; vrot: number;
    }
    const motes: Mote[] = Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.2 + Math.random() * 2.6,
      vy: 0.01 + Math.random() * 0.025, // 화면 높이/초 — 위로 떠오름
      vx: (Math.random() - 0.5) * 0.008,
      a: 0.05 + Math.random() * 0.16,
      glyph: Math.random() < 0.18 ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : null,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.5,
    }));
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.y -= m.vy * dt;
        m.x += m.vx * dt;
        m.rot += m.vrot * dt;
        if (m.y < -0.05) {
          m.y = 1.05;
          m.x = Math.random();
        }
        if (m.glyph) {
          ctx.save();
          ctx.translate(m.x * w, m.y * h);
          ctx.rotate(m.rot);
          ctx.globalAlpha = m.a * 0.8;
          ctx.fillStyle = '#c9b4ff';
          ctx.font = `${Math.round(m.r * 7 * dpr)}px 'Jua', sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(m.glyph, 0, 0);
          ctx.restore();
        } else {
          ctx.globalAlpha = m.a;
          ctx.fillStyle = Math.random() < 0.02 ? '#ffd166' : '#8f6bff';
          ctx.beginPath();
          ctx.arc(m.x * w, m.y * h, m.r * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, []);
  return <canvas ref={ref} className="title-fx" />;
}

// 타이틀 화면 — 모험 시작 · 오늘의 던전 · 자동 시연 세로 메뉴.
// 시연은 언제든 볼 수 있게 상시 노출 (최신 콘텐츠를 계속 보여 주는 쇼케이스).
export default function TitleScreen({
  best,
  memCount,
  memIds,
  storySeen,
  muted,
  gfx,
  dexPct,
  dailyRecord,
  onToggleMute,
  onToggleGfx,
  onStart,
  onDaily,
  onReplay,
  onDemo,
  onDex,
}: {
  best: number;
  memCount: number;
  memIds: string[]; // 되찾은 기억 id — 갈래 진행도 표시용
  storySeen: boolean;
  muted: boolean;
  gfx: 'high' | 'lite'; // 그래픽 품질 (⚡가벼움 = 기존 렌더 경로)
  dexPct: number; // 도감 「채워지는 책」 수집률
  dailyRecord: DailyRecord | null; // 오늘 날짜의 기록 (없으면 null)
  onToggleMute: () => void;
  onToggleGfx: () => void;
  onStart: () => void;
  onDaily: () => void;
  onReplay: () => void;
  onDemo: () => void;
  onDex: () => void;
}) {
  return (
    <div className="screen title-screen">
      <TitleFx />
      <button className="hud-chip mute-btn title-mute" onClick={onToggleMute}>
        {muted ? '🔇' : '🔊'}
      </button>
      {/* 그래픽 품질 토글 — ⚡가벼움(성능 우선·기존 그래픽) / ✨고품질(블룸·텍스처) */}
      <button className="hud-chip mute-btn title-gfx" onClick={onToggleGfx}>
        {gfx === 'lite' ? '⚡ 가벼움' : '✨ 고품질'}
      </button>
      <h1>백층 던전</h1>
      <p className="tagline">책 속으로 떨어진 대학생의 귀환 대작전 — 100층까지 내려가라!</p>
      <div className="howto">
        <p>🕹️ 이동: 화면 드래그 (PC는 WASD/방향키)</p>
        <p>⚔️ 공격: 가까운 적을 자동으로 조준</p>
        <p>🗝️ 보물상자 = 두 문 달리기! 깊이 달릴수록 좋은 보물</p>
        <p>🌀 포털로 다음 층 — 내려갈지는 당신의 선택</p>
      </div>
      {best > 0 && (
        <p className="best">
          최고 기록: {best}층 · 되찾은 기억 {Math.min(memCount, MEMORIES.length)} / {MEMORIES.length}
        </p>
      )}
      {memCount > 0 && <SetProgressRow collected={memIds} />}
      {dailyRecord && (
        <p className="best">
          📅 오늘의 던전 기록: {dailyRecord.cleared ? '100층 완주!' : `${dailyRecord.floor}층`}
        </p>
      )}
      {/* 첫 항목이 기본 하이라이트 — Enter는 언제나 '모험 시작' */}
      <ChoiceList
        kind="big"
        items={[
          { key: 'start', label: '모험 시작', onPick: onStart },
          { key: 'daily', label: '📅 오늘의 던전', className: 'daily-btn', onPick: onDaily },
          { key: 'demo', label: '🎬 자동 시연 보기', className: 'demo-start', onPick: onDemo },
        ]}
      />
      <p className="quiz-sub daily-hint">
        📅 오늘의 던전: 날짜가 시드 — 모두가 같은 맵에 도전 (기록 카드로 인증)
        <br />
        🎬 자동 시연: 게임이 스스로 주요 장면을 보여 줍니다 (약 2분, 언제든 중단 가능)
      </p>
      <div className="story-btns">
        {dexPct > 0 && (
          <button className="skip-btn" onClick={onDex}>
            📖 채워지는 책 {dexPct}%
          </button>
        )}
        {storySeen && (
          <button className="skip-btn" onClick={onReplay}>
            🔖 스토리 다시 보기
          </button>
        )}
      </div>
    </div>
  );
}
