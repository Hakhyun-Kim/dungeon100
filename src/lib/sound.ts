// Web Audio로 합성하는 효과음 — 파일 없이 가볍게 (두 문 러너 방식 확장판).
// AudioContext는 반드시 사용자 입력(클릭/터치) 안에서 생성/재개되어야 한다.
//
// ⚠️ 여기가 사운드의 기본값이다: 새 소리는 먼저 아래 tone()/noise() 두 도구로 만들어 본다.
// 오디오 파일을 들이는 건 사다리 ③(최후 수단) — 규칙·대장은 docs/ASSETS.md,
// 검사는 `npm run assets-check`(대장에 없는 파일·호스트면 배포가 멈춘다).

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

// ── 마스터 버스 — 모든 소리가 반드시 이 한 노드를 지난다 (효과음·BGM 공통).
// 예전엔 전부 destination 직결이라 연사 히트 + BGM + 보스 포효가 겹치는 순간 합이 1을 넘어
// 지직거렸다. 컴프레서가 봉우리만 눌러 주므로 개별 소리의 vol을 낮추지 않고도 정리된다.
let bus: GainNode | undefined;
export function masterBus(c: AudioContext): AudioNode {
  if (!bus || bus.context !== c) {
    const g = c.createGain();
    g.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    g.connect(comp);
    comp.connect(c.destination);
    bus = g;
  }
  return bus;
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
  g.connect(masterBus(c));
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

// q = 밴드패스 첨예도. 높을수록 좁고 날카롭게(딱—), 낮을수록 넓고 묵직하게(퍽—) 들린다.
function noise(c: AudioContext, start: number, dur: number, vol = 0.08, freq = 1200, q = 1) {
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
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f);
  f.connect(g);
  g.connect(masterBus(c));
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
  // 투사체 명중 (아주 짧은 틱 — Q를 높여 연사해도 뭉개지지 않게 또렷하게)
  hit() {
    const now = performance.now();
    if (now - lastHit < 45) return;
    lastHit = now;
    play((c) => noise(c, 0, 0.05, 0.05, 2400, 5));
  },
  // 치명타 명중 — 평타와 '들어서' 구분되게 위에 밝은 핑을 하나 얹는다.
  // 히트스톱(0.55)이 화면을 얼리는 그 순간에 소리도 같이 도드라져야 한 방이 무겁게 읽힌다.
  crit() {
    const now = performance.now();
    if (now - lastHit < 40) return;
    lastHit = now;
    play((c) => {
      noise(c, 0, 0.06, 0.06, 3200, 9);
      tone(c, 1567.98, 0.01, 0.1, 'triangle', 0.07, 2093);
    });
  },
  // 처치 (뽁!)
  kill() {
    play((c) => {
      tone(c, 320, 0, 0.12, 'square', 0.07, 140);
      noise(c, 0, 0.1, 0.06, 900, 1.2);
    });
  },
  // 피격 (묵직하게 — Q를 낮춰 넓게 퍼지는 둔탁한 몸통)
  hurt() {
    play((c) => {
      tone(c, 130, 0, 0.18, 'sine', 0.14, 70);
      noise(c, 0, 0.12, 0.06, 300, 0.7);
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
  // 차지 완충 — "이제 놓아도 된다"를 귀로 알리는 신호.
  // 발밑 링만으로는 전투 중에 안 보인다(시선은 무리에 가 있다) → 청각으로 옮긴 것.
  chargeReady() {
    play((c) => {
      tone(c, 1046.5, 0, 0.07, 'triangle', 0.06);
      tone(c, 1567.98, 0.06, 0.12, 'triangle', 0.06);
    });
  },
  // 차지 방출 — 세기(0.35~1)에 따라 굵어지는 한 방.
  // 예전엔 문 통과 징글(pass)을 재활용해 '전투의 한 방'으로 안 들렸다.
  blast(power = 1) {
    play((c) => {
      const v = 0.09 + power * 0.07;
      tone(c, 520 + power * 220, 0, 0.26, 'sawtooth', v, 110);
      noise(c, 0, 0.16, v * 0.7, 700 + power * 500, 0.6);
      tone(c, 880, 0.02, 0.1, 'triangle', 0.05, 1318.5);
    });
  },
  // 역류 카운트다운 — 마지막 몇 초에 한 번씩 (초침처럼)
  countdown(urgent = false) {
    play((c) => tone(c, urgent ? 1318.5 : 880, 0, 0.05, 'square', urgent ? 0.08 : 0.05));
  },
  // 봉인 해제 (포털 열림)
  unlock() {
    play((c) => {
      tone(c, 659.25, 0, 0.12, 'triangle', 0.1);
      tone(c, 987.77, 0.1, 0.14, 'triangle', 0.1);
      tone(c, 1318.5, 0.22, 0.3, 'sine', 0.09);
    });
  },
  // 찰나 게이지 완충 — 밝고 짧은 얼음 핑 ("이제 눌러도 된다")
  freezeReady() {
    play((c) => {
      tone(c, 1760, 0, 0.05, 'sine', 0.05);
      tone(c, 2349.32, 0.04, 0.09, 'sine', 0.05);
    });
  },
  // 찰나 발동 — 세계가 얼어붙는 순간. 높은 배음이 위로 얼어 굳는다.
  freeze() {
    play((c) => {
      noise(c, 0, 0.5, 0.07, 3800, 7);
      tone(c, 1567.98, 0, 0.5, 'sine', 0.06, 2093);
      tone(c, 784, 0.02, 0.45, 'triangle', 0.05, 1046.5);
    });
  },
  // 결의 게이지 완충 — 산뜻한 상승 핑. 찰나(freezeReady)의 서늘한 얼음 톤과 대비되는
  // 따뜻한 삼각파로 "같은 자원이 아니다"를 소리로도 구분한다.
  resolveReady() {
    play((c) => {
      tone(c, 987.77, 0, 0.05, 'triangle', 0.05);
      tone(c, 1318.5, 0.04, 0.09, 'triangle', 0.05);
    });
  },
  // 결의 발동 — 무적 대시. 스치는 바람(노이즈 스윕) + 짧은 배음
  resolve() {
    play((c) => {
      noise(c, 0, 0.18, 0.09, 2200, 2.5);
      tone(c, 440, 0, 0.14, 'sawtooth', 0.06, 880);
    });
  },
};

// ── 차지 허밍 — 단발 효과음과 달리 '누르고 있는 동안' 유지되는 유일한 소리.
// 오실레이터 하나를 살려 두고 축적량으로 음정·필터를 끌어올린다 = 힘이 차오르는 게 들린다.
// 반드시 stop()으로 회수할 것 (오버레이·언마운트에서 안 끄면 화면 뒤에서 계속 운다).
let hum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;

export const chargeHum = {
  start() {
    if (hum || isMuted()) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.Q.value = 5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.08);
    o.connect(f);
    f.connect(g);
    g.connect(masterBus(c));
    o.start(t);
    hum = { osc: o, gain: g, filter: f };
  },
  // p = 0~1 축적량. 매 프레임 호출 (음소거로 바뀌면 스스로 멎는다)
  set(p: number) {
    if (!hum) return;
    if (isMuted()) {
      chargeHum.stop();
      return;
    }
    const c = ac();
    if (!c) return;
    const t = c.currentTime;
    hum.osc.frequency.setTargetAtTime(140 + p * p * 280, t, 0.05);
    hum.filter.frequency.setTargetAtTime(500 + p * 1800, t, 0.05);
  },
  stop() {
    const v = hum;
    hum = null;
    if (!v) return;
    const c = ac();
    if (!c) {
      try {
        v.osc.stop();
      } catch {
        // 이미 멈춘 오실레이터 — 무시
      }
      return;
    }
    const t = c.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    v.osc.stop(t + 0.12);
  },
};
