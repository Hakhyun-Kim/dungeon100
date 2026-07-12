// Web Audio로 합성하는 효과음 — 파일 없이 가볍게 (두 문 러너 방식 확장판).
// AudioContext는 반드시 사용자 입력(클릭/터치) 안에서 생성/재개되어야 한다.

let ctx: AudioContext | undefined;

function ac(): AudioContext | null {
  try {
    if (typeof AudioContext === 'undefined') return null;
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// music.ts 등 다른 모듈이 같은 AudioContext를 공유
export function getAc(): AudioContext | null {
  return ac();
}

export const isMuted = () => {
  try {
    return localStorage.getItem('d100-muted') === '1';
  } catch {
    return false;
  }
};
export const setMuted = (m: boolean) => {
  try {
    localStorage.setItem('d100-muted', m ? '1' : '0');
  } catch {
    // 무시
  }
};

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'triangle',
  vol = 0.12,
  glideTo?: number,
) {
  const t0 = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function noise(c: AudioContext, start: number, dur: number, vol = 0.08, freq = 1200) {
  const t0 = c.currentTime + start;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(c.destination);
  src.start(t0);
}

function play(fn: (c: AudioContext) => void) {
  if (isMuted()) return;
  const c = ac();
  if (!c) return;
  fn(c);
}

// 타격음은 연사 때 도배되지 않게 살짝 제한
let lastHit = 0;

export const sfx = {
  // UI 터치/대화 진행
  tap() {
    play((c) => tone(c, 740, 0, 0.06, 'sine', 0.06));
  },
  // 보상 카드 선택
  pick() {
    play((c) => {
      tone(c, 523.25, 0, 0.1, 'triangle', 0.1);
      tone(c, 783.99, 0.07, 0.14, 'triangle', 0.1);
    });
  },
  // 투사체 명중 (아주 짧은 틱)
  hit() {
    const now = performance.now();
    if (now - lastHit < 45) return;
    lastHit = now;
    play((c) => noise(c, 0, 0.05, 0.05, 2400));
  },
  // 처치 (뽁!)
  kill() {
    play((c) => {
      tone(c, 320, 0, 0.12, 'square', 0.07, 140);
      noise(c, 0, 0.1, 0.06, 900);
    });
  },
  // 피격 (묵직하게)
  hurt() {
    play((c) => {
      tone(c, 130, 0, 0.18, 'sine', 0.14, 70);
      noise(c, 0, 0.12, 0.06, 300);
    });
  },
  // 두 문 달리기 시작 (출발 신호)
  doorrun() {
    play((c) => {
      tone(c, 392, 0, 0.09, 'square', 0.08);
      tone(c, 523.25, 0.1, 0.12, 'square', 0.08);
    });
  },
  // 정답 문 통과: 밝은 상승 아르페지오 (도-미-솔-도) — 두 문 러너와 같은 감각
  pass() {
    play((c) => {
      tone(c, 523.25, 0, 0.16);
      tone(c, 659.25, 0.09, 0.16);
      tone(c, 783.99, 0.18, 0.16);
      tone(c, 1046.5, 0.27, 0.28, 'triangle', 0.14);
    });
  },
  // 오답 충돌: 낮게 두 번 "뿌-붑" (기죽지 않게 부드럽게)
  crash() {
    play((c) => {
      tone(c, 220, 0, 0.18, 'sine', 0.1);
      tone(c, 174.61, 0.16, 0.24, 'sine', 0.1);
      noise(c, 0, 0.15, 0.07, 500);
    });
  },
  // 보물 획득 (금빛 반짝)
  treasure() {
    play((c) => {
      tone(c, 1318.5, 0, 0.1, 'sine', 0.08);
      tone(c, 1567.98, 0.08, 0.1, 'sine', 0.08);
      tone(c, 2093, 0.16, 0.22, 'sine', 0.08);
    });
  },
  // 전설의 보물 (긴 팡파르)
  legend() {
    play((c) => {
      tone(c, 523.25, 0, 0.14);
      tone(c, 659.25, 0.1, 0.14);
      tone(c, 783.99, 0.2, 0.14);
      tone(c, 1046.5, 0.3, 0.2, 'triangle', 0.14);
      tone(c, 1318.5, 0.42, 0.34, 'triangle', 0.12);
      tone(c, 2093, 0.5, 0.3, 'sine', 0.07);
    });
  },
  // 되찾은 기억 (따뜻한 차임)
  memory() {
    play((c) => {
      tone(c, 523.25, 0, 0.5, 'sine', 0.07);
      tone(c, 659.25, 0.12, 0.5, 'sine', 0.06);
      tone(c, 987.77, 0.3, 0.7, 'sine', 0.05);
    });
  },
  // 벽의 글귀 (낮게 신비롭게)
  lore() {
    play((c) => {
      tone(c, 196, 0, 0.6, 'sine', 0.06);
      tone(c, 246.94, 0.15, 0.6, 'sine', 0.05);
    });
  },
  // 포털 (아래로 슝)
  portal() {
    play((c) => {
      tone(c, 660, 0, 0.4, 'sawtooth', 0.05, 160);
      noise(c, 0, 0.35, 0.05, 700);
    });
  },
  // 마을 문 종소리 (뎅— 뎅—)
  bell() {
    play((c) => {
      tone(c, 880, 0, 0.7, 'sine', 0.09);
      tone(c, 1318.5, 0, 0.5, 'sine', 0.04);
      tone(c, 880, 0.5, 0.9, 'sine', 0.07);
      tone(c, 1318.5, 0.5, 0.6, 'sine', 0.03);
    });
  },
  // 선물 (반짝)
  gift() {
    play((c) => {
      tone(c, 1046.5, 0, 0.1, 'sine', 0.08);
      tone(c, 1568, 0.08, 0.18, 'sine', 0.08);
    });
  },
  // 게임오버 (쓸쓸하게 세 음)
  over() {
    play((c) => {
      tone(c, 392, 0, 0.25, 'sine', 0.1);
      tone(c, 311.13, 0.22, 0.25, 'sine', 0.1);
      tone(c, 233.08, 0.44, 0.5, 'sine', 0.1);
    });
  },
  // 던전 입장 (모험 시작!)
  enter() {
    play((c) => {
      tone(c, 392, 0, 0.12, 'triangle', 0.1);
      tone(c, 523.25, 0.1, 0.12, 'triangle', 0.1);
      tone(c, 659.25, 0.2, 0.24, 'triangle', 0.12);
    });
  },
  // 위기의 심장박동 (쿵-쿵)
  heartbeat() {
    play((c) => {
      tone(c, 58, 0, 0.12, 'sine', 0.16, 40);
      tone(c, 52, 0.16, 0.14, 'sine', 0.12, 38);
    });
  },
  // 보스 등장 포효 (낮게 우르릉)
  roar() {
    play((c) => {
      tone(c, 90, 0, 0.7, 'sawtooth', 0.09, 55);
      noise(c, 0, 0.5, 0.07, 220);
    });
  },
  // 봉인 해제 (포털 열림)
  unlock() {
    play((c) => {
      tone(c, 659.25, 0, 0.12, 'triangle', 0.1);
      tone(c, 987.77, 0.1, 0.14, 'triangle', 0.1);
      tone(c, 1318.5, 0.22, 0.3, 'sine', 0.09);
    });
  },
};
