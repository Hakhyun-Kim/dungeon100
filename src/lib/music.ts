// 절차 생성 BGM — 파일 없이 Web Audio로 실시간 시퀀싱.
// 트랙: title(잔잔한 패드) / town(따뜻한 왈츠) / dungeon(긴장 루프, 깊이에 따라 빨라짐) /
//       doorrun(질주 리듬) / boss(급박한 오스티나토)
import { getAc, isMuted } from './sound';

export type MusicTrack = 'title' | 'town' | 'dungeon' | 'doorrun' | 'boss';

let current: MusicTrack | null = null;
let depth = 0; // 던전 티어 (5층 단위) — 템포·음색 변화
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0;
let step = 0;

const F = (semi: number, base = 110) => base * Math.pow(2, semi / 12);

function inst(
  c: AudioContext,
  freq: number,
  t: number,
  dur: number,
  type: OscillatorType,
  vol: number,
) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function hat(c: AudioContext, t: number, vol = 0.015) {
  const len = Math.floor(c.sampleRate * 0.03);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 6000;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t);
}

// 16분음표 스텝 단위 패턴 (null = 쉼)
const DUNGEON_BASS = [0, null, null, 0, null, null, 3, null, -2, null, null, -2, null, 3, 5, null];
const DUNGEON_LEAD = [null, null, 12, null, null, null, null, null, 10, null, 7, null, null, null, 3, null];
const TOWN_BASS = [0, null, null, null, 4, 7, null, null, 5, null, null, null, 9, 12, null, null];
const TOWN_LEAD = [12, null, 11, null, 9, null, 7, null, 9, null, 12, null, 16, null, 14, null];
const RUN_BASS = [0, null, 0, null, 0, null, 3, null, 5, null, 5, null, 7, null, 3, null];
const BOSS_BASS = [0, 0, null, 0, 0, 0, null, 0, -1, -1, null, -1, 1, 1, null, 1];

function scheduleStep(c: AudioContext, track: MusicTrack, i: number, t: number, stepDur: number) {
  const s = i % 16;
  if (track === 'dungeon') {
    const oct = depth >= 3 ? -12 : 0; // 깊으면 한 옥타브 아래로
    const b = DUNGEON_BASS[s];
    if (b !== null) inst(c, F(b + oct, 110), t, stepDur * 2.2, 'triangle', 0.045);
    const l = DUNGEON_LEAD[s];
    if (l !== null && i % 32 >= 16) inst(c, F(l, 220), t, stepDur * 3, 'sine', 0.028);
    if (s % 4 === 2) hat(c, t, 0.01);
  } else if (track === 'town') {
    const b = TOWN_BASS[s];
    if (b !== null) inst(c, F(b, 110), t, stepDur * 2.5, 'triangle', 0.04);
    const l = TOWN_LEAD[s];
    if (l !== null) inst(c, F(l, 220), t, stepDur * 2.8, 'sine', 0.03);
  } else if (track === 'doorrun') {
    const b = RUN_BASS[s];
    if (b !== null) inst(c, F(b, 110), t, stepDur * 1.4, 'square', 0.035);
    if (s % 2 === 1) hat(c, t, 0.014);
  } else if (track === 'boss') {
    const b = BOSS_BASS[s];
    if (b !== null) inst(c, F(b - 12, 110), t, stepDur * 1.3, 'sawtooth', 0.04);
    if (s === 0) inst(c, F(12, 220), t, stepDur * 6, 'sawtooth', 0.02);
    if (s === 8) inst(c, F(13, 220), t, stepDur * 6, 'sawtooth', 0.02);
    if (s % 2 === 0) hat(c, t, 0.012);
  } else {
    // title — 두 코드가 번갈아 흐르는 패드
    if (s === 0) {
      const chord = i % 64 < 32 ? [0, 3, 7] : [-4, 0, 5]; // Am ↔ F
      chord.forEach((n) => inst(c, F(n, 220), t, stepDur * 14, 'sine', 0.02));
    }
  }
}

function tempoOf(track: MusicTrack): number {
  if (track === 'dungeon') return 96 + Math.min(48, depth * 9);
  if (track === 'town') return 118;
  if (track === 'doorrun') return 148;
  if (track === 'boss') return 152;
  return 64;
}

function tick() {
  const c = getAc();
  if (!c || !current) return;
  const stepDur = 60 / tempoOf(current) / 4;
  while (nextTime < c.currentTime + 0.45) {
    scheduleStep(c, current, step, nextTime, stepDur);
    step++;
    nextTime += stepDur;
  }
}

export const music = {
  play(name: MusicTrack, d = 0) {
    depth = d;
    if (current === name && timer) return;
    current = name;
    if (isMuted()) return; // 트랙만 기억해 두고 sync()에서 재개
    const c = getAc();
    if (!c) return;
    if (timer) clearInterval(timer);
    step = 0;
    nextTime = c.currentTime + 0.08;
    timer = setInterval(tick, 140);
    tick();
  },
  stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    current = null;
  },
  // 음소거 토글 후 상태 재적용
  sync() {
    if (isMuted()) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return;
    }
    if (current && !timer) {
      const c = getAc();
      if (!c) return;
      step = 0;
      nextTime = c.currentTime + 0.08;
      timer = setInterval(tick, 140);
      tick();
    }
  },
};
