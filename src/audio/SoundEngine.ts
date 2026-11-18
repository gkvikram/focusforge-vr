/**
 * Zero-asset audio for FocusForge VR. Everything is synthesized with the Web
 * Audio API: oscillators, filtered noise, LFOs and tiny envelopes.
 *
 * The AudioContext is created lazily and unlocked by the first tap, click,
 * key press or XR select (pinch) so browsers never block playback.
 */

export type AmbientChannel = 'rain' | 'lofi' | 'synthwave';
export const AMBIENT_CHANNELS: readonly AmbientChannel[] = ['rain', 'lofi', 'synthwave'];

const CHANNEL_LEVEL: Record<AmbientChannel, number> = {
  rain: 0.55,
  lofi: 0.6,
  synthwave: 0.5,
};

/** G5 A5 C6 E6 G6 - one crystalline note per stress target. */
const CHIME_NOTES = [783.99, 880, 1046.5, 1318.5, 1568];
/** Inharmonic bell partials: ratio, relative gain, decay seconds. */
const BELL_PARTIALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 2.2],
  [2.756, 0.5, 1.4],
  [5.404, 0.26, 0.8],
  [8.933, 0.12, 0.45],
];

const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

interface SessionLike {
  addEventListener(type: string, listener: () => void): void;
}

interface NoiseAssets {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  crackle: AudioBuffer;
}

type NoiseKind = 'white' | 'pink' | 'brown';

function makeNoise(ctx: AudioContext, seconds: number, kind: NoiseKind): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') {
      data[i] = white * 0.9;
    } else if (kind === 'pink') {
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    } else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

function makeCrackle(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    if (Math.random() < 0.0009) {
      data[i] = (Math.random() * 2 - 1) * (0.25 + Math.random() * 0.75);
    }
  }
  return buffer;
}

function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
  }
  return buffer;
}

interface NoteOptions {
  type: OscillatorType;
  freq: number;
  start: number;
  attack?: number;
  hold?: number;
  release?: number;
  gain: number;
  detune?: number;
  glideTo?: number;
  pan?: number;
}

function playNote(ctx: AudioContext, destination: AudioNode, options: NoteOptions): void {
  const { type, freq, start, gain } = options;
  const attack = options.attack ?? 0.01;
  const hold = options.hold ?? 0;
  const release = options.release ?? 0.3;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (options.glideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(options.glideTo, start + attack + hold + release);
  }
  if (options.detune) osc.detune.value = options.detune;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  env.gain.setValueAtTime(gain, start + attack + hold);
  env.gain.setTargetAtTime(0.0001, start + attack + hold, release / 3);

  osc.connect(env);
  let tail: AudioNode = env;
  if (options.pan != null && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = options.pan;
    env.connect(panner);
    tail = panner;
  }
  tail.connect(destination);
  const end = start + attack + hold + release + 0.1;
  osc.start(start);
  osc.stop(end);
  osc.onended = () => {
    osc.disconnect();
    tail.disconnect();
    if (tail !== env) env.disconnect();
  };
}

function noiseBurst(
  ctx: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  options: {
    start: number;
    duration: number;
    gain: number;
    filter: BiquadFilterType;
    freq: number;
    freqEnd?: number;
    q?: number;
  },
): void {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.Q.value = options.q ?? 0.8;
  filter.frequency.setValueAtTime(options.freq, options.start);
  if (options.freqEnd != null) {
    filter.frequency.exponentialRampToValueAtTime(options.freqEnd, options.start + options.duration);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, options.start);
  env.gain.exponentialRampToValueAtTime(options.gain, options.start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, options.start + options.duration);
  source.connect(filter).connect(env).connect(destination);
  source.start(options.start, Math.random() * 1.5);
  source.stop(options.start + options.duration + 0.05);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    env.disconnect();
  };
}

abstract class AmbientLoop {
  readonly output: GainNode;
  active = false;
  protected built = false;
  protected nextTime = 0;
  private teardownTimer = 0;
  private cleanups: Array<() => void> = [];

  constructor(
    protected readonly ctx: AudioContext,
    protected readonly noise: NoiseAssets,
    destination: AudioNode,
    private readonly level: number,
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(destination);
  }

  protected abstract build(): void;
  abstract schedule(until: number): void;

  start(): void {
    window.clearTimeout(this.teardownTimer);
    if (!this.built) {
      this.build();
      this.built = true;
      this.nextTime = this.ctx.currentTime + 0.15;
    }
    this.active = true;
    this.output.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.6);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.output.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    this.teardownTimer = window.setTimeout(() => this.teardown(), 1600);
  }

  private teardown(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.built = false;
  }

  protected track(node: AudioScheduledSourceNode): void {
    this.cleanups.push(() => {
      try {
        node.stop();
      } catch {
        // already stopped
      }
      node.disconnect();
    });
  }

  protected own(...nodes: AudioNode[]): void {
    this.cleanups.push(() => nodes.forEach((node) => node.disconnect()));
  }

  protected loopNoise(buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.start(0, Math.random() * (buffer.duration - 0.1));
    this.track(source);
    return source;
  }

  protected lfo(frequency: number, depth: number, target: AudioParam): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = frequency;
    const amount = this.ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start();
    this.track(osc);
    this.own(amount);
  }
}

class RainLoop extends AmbientLoop {
  protected build(): void {
    const { ctx, output } = this;

    const bodyHigh = ctx.createBiquadFilter();
    bodyHigh.type = 'highpass';
    bodyHigh.frequency.value = 420;
    const bodyLow = ctx.createBiquadFilter();
    bodyLow.type = 'lowpass';
    bodyLow.frequency.value = 6800;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.5;
    this.loopNoise(this.noise.pink).connect(bodyHigh).connect(bodyLow).connect(bodyGain).connect(output);
    this.lfo(0.11, 0.12, bodyGain.gain);

    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.value = 3400;
    hissBand.Q.value = 0.6;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.1;
    this.loopNoise(this.noise.white, 0.9).connect(hissBand).connect(hissGain).connect(output);
    this.lfo(0.07, 0.04, hissGain.gain);

    const rumble = ctx.createBiquadFilter();
    rumble.type = 'lowpass';
    rumble.frequency.value = 190;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.22;
    this.loopNoise(this.noise.brown).connect(rumble).connect(rumbleGain).connect(output);

    this.own(bodyHigh, bodyLow, bodyGain, hissBand, hissGain, rumble, rumbleGain);
  }

  schedule(until: number): void {
    while (this.nextTime < until) {
      const freq = 1300 + Math.random() * 1900;
      playNote(this.ctx, this.output, {
        type: 'sine',
        freq,
        glideTo: freq * 0.6,
        start: this.nextTime,
        attack: 0.004,
        release: 0.09,
        gain: 0.035 + Math.random() * 0.03,
        pan: Math.random() * 1.6 - 0.8,
      });
      this.nextTime += 0.25 + Math.random() * 1.3;
    }
  }
}

const LOFI_CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
];
const LOFI_BEAT = 60 / 72;

class LofiLoop extends AmbientLoop {
  private bus!: GainNode;
  private chordIndex = 0;

  protected build(): void {
    const { ctx, output } = this;
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 1500;
    warmth.Q.value = 0.4;
    this.lfo(0.17, 320, warmth.frequency);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = LOFI_BEAT * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 1100;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.bus.connect(warmth);
    warmth.connect(output);
    warmth.connect(delay);
    delay.connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(wet).connect(output);

    const crackleHigh = ctx.createBiquadFilter();
    crackleHigh.type = 'highpass';
    crackleHigh.frequency.value = 1800;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.2;
    this.loopNoise(this.noise.crackle).connect(crackleHigh).connect(crackleGain).connect(output);

    const hissLow = ctx.createBiquadFilter();
    hissLow.type = 'lowpass';
    hissLow.frequency.value = 3200;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.012;
    this.loopNoise(this.noise.white).connect(hissLow).connect(hissGain).connect(output);

    this.own(this.bus, warmth, delay, feedback, delayTone, wet, crackleHigh, crackleGain, hissLow, hissGain);
  }

  schedule(until: number): void {
    while (this.nextTime < until) {
      this.scheduleBar(this.nextTime);
      this.nextTime += LOFI_BEAT * 4;
    }
  }

  private scheduleBar(start: number): void {
    const { ctx, bus } = this;
    const chord = LOFI_CHORDS[this.chordIndex % LOFI_CHORDS.length];
    this.chordIndex++;

    chord.forEach((note, i) => {
      const t = start + i * 0.035 + Math.random() * 0.012;
      const freq = midiToHz(note);
      playNote(ctx, bus, { type: 'sine', freq, start: t, attack: 0.015, hold: 1.1, release: 1.8, gain: 0.07 });
      playNote(ctx, bus, {
        type: 'triangle',
        freq,
        detune: 6,
        start: t,
        attack: 0.02,
        hold: 0.8,
        release: 1.4,
        gain: 0.03,
      });
    });
    for (const note of chord.slice(2)) {
      playNote(ctx, bus, {
        type: 'sine',
        freq: midiToHz(note),
        start: start + LOFI_BEAT * 2 + Math.random() * 0.02,
        attack: 0.015,
        hold: 0.5,
        release: 1.2,
        gain: 0.04,
      });
    }

    const root = midiToHz(chord[0] - 12);
    playNote(ctx, this.output, { type: 'sine', freq: root, start, attack: 0.03, hold: 0.9, release: 0.9, gain: 0.16 });
    playNote(ctx, this.output, {
      type: 'sine',
      freq: root,
      start: start + LOFI_BEAT * 2.5,
      attack: 0.03,
      hold: 0.4,
      release: 0.6,
      gain: 0.1,
    });

    for (const beat of [0, 2]) {
      playNote(ctx, this.output, {
        type: 'sine',
        freq: 120,
        glideTo: 44,
        start: start + beat * LOFI_BEAT,
        attack: 0.004,
        release: 0.2,
        gain: 0.14,
      });
    }
    for (const beat of [1, 3]) {
      noiseBurst(ctx, this.output, this.noise.white, {
        start: start + beat * LOFI_BEAT,
        duration: 0.09,
        gain: 0.05,
        filter: 'highpass',
        freq: 6500,
      });
    }
    for (const beat of [0.5, 1.5, 2.5, 3.5]) {
      noiseBurst(ctx, this.output, this.noise.white, {
        start: start + beat * LOFI_BEAT + 0.02,
        duration: 0.04,
        gain: 0.018,
        filter: 'highpass',
        freq: 8000,
      });
    }
  }
}

const SYNTH_CHORDS = [
  { notes: [57, 60, 64], bass: 45 },
  { notes: [53, 57, 60], bass: 41 },
  { notes: [55, 60, 64], bass: 36 },
  { notes: [55, 59, 62], bass: 43 },
];
const SYNTH_BEAT = 60 / 84;
const ARP_PATTERN = [0, 1, 2, 1, 2, 1, 0, 1];

class SynthwaveLoop extends AmbientLoop {
  private pad!: GainNode;
  private arp!: GainNode;
  private chordIndex = 0;

  protected build(): void {
    const { ctx, output } = this;

    this.pad = ctx.createGain();
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 1100;
    padFilter.Q.value = 2;
    this.lfo(0.09, 650, padFilter.frequency);
    this.pad.connect(padFilter).connect(output);

    this.arp = ctx.createGain();
    const arpFilter = ctx.createBiquadFilter();
    arpFilter.type = 'lowpass';
    arpFilter.frequency.value = 2200;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = SYNTH_BEAT * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.arp.connect(arpFilter);
    arpFilter.connect(output);
    arpFilter.connect(delay);
    delay.connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(wet).connect(output);

    this.own(this.pad, padFilter, this.arp, arpFilter, delay, feedback, delayTone, wet);
  }

  schedule(until: number): void {
    while (this.nextTime < until) {
      this.scheduleBar(this.nextTime);
      this.nextTime += SYNTH_BEAT * 4;
    }
  }

  private scheduleBar(start: number): void {
    const { ctx } = this;
    const chord = SYNTH_CHORDS[this.chordIndex % SYNTH_CHORDS.length];
    this.chordIndex++;
    const barLength = SYNTH_BEAT * 4;

    for (const note of chord.notes) {
      const freq = midiToHz(note);
      for (const detune of [-8, 8]) {
        playNote(ctx, this.pad, {
          type: 'sawtooth',
          freq,
          detune,
          start,
          attack: 0.9,
          hold: barLength - 0.7,
          release: 1.4,
          gain: 0.028,
        });
      }
    }

    const eighth = SYNTH_BEAT / 2;
    for (let step = 0; step < 8; step++) {
      const t = start + step * eighth;
      const note = chord.notes[ARP_PATTERN[step] % chord.notes.length] + 12;
      playNote(ctx, this.arp, {
        type: 'sawtooth',
        freq: midiToHz(note),
        start: t,
        attack: 0.005,
        release: 0.3,
        gain: 0.05,
      });
      playNote(ctx, this.output, {
        type: 'sawtooth',
        freq: midiToHz(chord.bass),
        start: t,
        attack: 0.01,
        release: 0.22,
        gain: step % 2 === 0 ? 0.075 : 0.045,
      });
    }

    for (const beat of [0, 2]) {
      playNote(ctx, this.output, {
        type: 'sine',
        freq: 110,
        glideTo: 42,
        start: start + beat * SYNTH_BEAT,
        attack: 0.004,
        release: 0.2,
        gain: 0.1,
      });
    }
  }
}

type Listener = () => void;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private reverbSend!: GainNode;
  private noise!: NoiseAssets;
  private loops = new Map<AmbientChannel, AmbientLoop>();
  private timer = 0;
  private listeners = new Set<Listener>();
  private installed = false;
  private attachedSessions = new WeakSet<object>();

  private channelState: Record<AmbientChannel, boolean> = {
    rain: false,
    lofi: false,
    synthwave: false,
  };
  private mutedState = false;

  get muted(): boolean {
    return this.mutedState;
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  isChannelOn(channel: AmbientChannel): boolean {
    return this.channelState[channel];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Unlock on the first user gesture of any kind. Safe to call repeatedly. */
  installUnlock(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const handler = () => this.unlock();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, handler, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ctx?.state === 'suspended') this.ctx.resume().catch(() => undefined);
    });
  }

  /** XR pinch and controller selects do not raise DOM events; listen on the session. */
  attachXRSession(session: SessionLike | null | undefined): void {
    if (session == null || this.attachedSessions.has(session)) return;
    this.attachedSessions.add(session);
    const handler = () => this.unlock();
    for (const type of ['selectstart', 'select', 'squeezestart', 'inputsourceschange']) {
      session.addEventListener(type, handler);
    }
    this.unlock();
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx == null) return;
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => undefined);
    }
  }

  toggleChannel(channel: AmbientChannel): boolean {
    return this.setChannel(channel, !this.channelState[channel]);
  }

  setChannel(channel: AmbientChannel, on: boolean): boolean {
    this.unlock();
    this.channelState[channel] = on;
    this.applyChannel(channel);
    this.switchClick(on);
    this.emit();
    return on;
  }

  toggleMuted(): boolean {
    this.unlock();
    this.mutedState = !this.mutedState;
    this.applyMute();
    this.emit();
    return this.mutedState;
  }

  switchClick(on: boolean): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    noiseBurst(ctx, this.sfxBus, this.noise.white, {
      start: t,
      duration: 0.03,
      gain: 0.18,
      filter: 'bandpass',
      freq: on ? 2400 : 1600,
      q: 1.2,
    });
    playNote(ctx, this.sfxBus, {
      type: 'sine',
      freq: on ? 190 : 140,
      glideTo: on ? 120 : 80,
      start: t,
      attack: 0.003,
      release: 0.07,
      gain: 0.2,
    });
  }

  cardMove(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    playNote(ctx, this.sfxBus, { type: 'triangle', freq: 520, glideTo: 760, start: t, attack: 0.005, release: 0.16, gain: 0.1 });
    playNote(ctx, this.sfxBus, { type: 'sine', freq: 1040, start: t + 0.05, attack: 0.005, release: 0.2, gain: 0.05 });
  }

  timerBell(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    this.bell(659.25, t, 0.45);
    this.bell(987.77, t + 0.18, 0.35);
    this.bell(1318.5, t + 0.38, 0.3);
  }

  orbSpawn(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    playNote(ctx, this.sfxBus, { type: 'sine', freq: 320, glideTo: 960, start: t, attack: 0.02, hold: 0.1, release: 0.35, gain: 0.12 });
    playNote(ctx, this.sfxBus, { type: 'triangle', freq: 640, glideTo: 1920, start: t + 0.04, attack: 0.02, release: 0.3, gain: 0.05 });
    this.bell(1174.7, t + 0.3, 0.2);
  }

  launch(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    noiseBurst(ctx, this.sfxBus, this.noise.pink, {
      start: t,
      duration: 0.4,
      gain: 0.3,
      filter: 'bandpass',
      freq: 500,
      freqEnd: 2800,
      q: 1.4,
    });
    playNote(ctx, this.sfxBus, { type: 'sine', freq: 780, glideTo: 220, start: t, attack: 0.01, release: 0.3, gain: 0.1 });
  }

  /** Crystal target breaking: a bell for its note plus a glassy tinkle of shards. */
  shatter(index: number): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    const base = CHIME_NOTES[index % CHIME_NOTES.length];
    this.bell(base, t, 0.5);
    this.bell(base * 1.5, t + 0.07, 0.26);
    noiseBurst(ctx, this.sfxBus, this.noise.white, {
      start: t,
      duration: 0.1,
      gain: 0.16,
      filter: 'highpass',
      freq: 5200,
    });
    for (let i = 0; i < 8; i++) {
      playNote(ctx, this.sfxBus, {
        type: 'sine',
        freq: 2200 + Math.random() * 3000,
        start: t + 0.02 + i * 0.03 + Math.random() * 0.03,
        attack: 0.002,
        release: 0.16,
        gain: 0.03 + Math.random() * 0.02,
        pan: Math.random() * 1.8 - 0.9,
      });
    }
  }

  beam(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    playNote(ctx, this.sfxBus, { type: 'sawtooth', freq: 180, glideTo: 1500, start: t, attack: 0.02, hold: 0.25, release: 0.2, gain: 0.04 });
    playNote(ctx, this.sfxBus, { type: 'sine', freq: 360, glideTo: 2400, start: t, attack: 0.02, hold: 0.25, release: 0.2, gain: 0.07 });
  }

  charge(level: number): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    const freq = 392 * 2 ** (level * 1.1);
    playNote(ctx, this.sfxBus, { type: 'sine', freq, glideTo: freq * 1.5, start: t, attack: 0.01, hold: 0.1, release: 0.5, gain: 0.14 });
    playNote(ctx, this.sfxBus, { type: 'triangle', freq: freq * 2, start: t, attack: 0.01, release: 0.45, gain: 0.05 });
  }

  overcharge(): void {
    const ctx = this.ready();
    if (ctx == null) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((freq, i) => {
      this.bell(freq, t + i * 0.09, 0.4);
    });
    playNote(ctx, this.sfxBus, { type: 'sine', freq: 130.8, start: t, attack: 0.05, hold: 0.8, release: 1.6, gain: 0.18 });
  }

  private bell(freq: number, start: number, gain: number): void {
    const ctx = this.ctx;
    if (ctx == null) return;
    for (const [ratio, weight, decay] of BELL_PARTIALS) {
      const partial = freq * ratio;
      if (partial > 14000) continue;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = partial;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(gain * weight, start + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, start + decay);
      osc.connect(env);
      env.connect(this.sfxBus);
      env.connect(this.reverbSend);
      osc.start(start);
      osc.stop(start + decay + 0.05);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
      };
    }
  }

  private ready(): AudioContext | null {
    const ctx = this.ctx;
    if (ctx == null || ctx.state !== 'running') return null;
    return ctx;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx != null) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor == null) return null;

    const ctx = new Ctor({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.master.connect(compressor).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 1.8);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(reverb).connect(this.master);

    this.noise = {
      white: makeNoise(ctx, 3, 'white'),
      pink: makeNoise(ctx, 4, 'pink'),
      brown: makeNoise(ctx, 4, 'brown'),
      crackle: makeCrackle(ctx, 4),
    };

    const ambient = ctx.createGain();
    ambient.gain.value = 0.9;
    ambient.connect(this.master);
    this.loops.set('rain', new RainLoop(ctx, this.noise, ambient, CHANNEL_LEVEL.rain));
    this.loops.set('lofi', new LofiLoop(ctx, this.noise, ambient, CHANNEL_LEVEL.lofi));
    this.loops.set('synthwave', new SynthwaveLoop(ctx, this.noise, ambient, CHANNEL_LEVEL.synthwave));

    // A one-sample silent buffer completes unlocking on iOS-style autoplay policies.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start(0);

    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.emit();
    });

    this.applyMute();
    for (const channel of AMBIENT_CHANNELS) this.applyChannel(channel);
    this.timer = window.setInterval(() => this.tick(), 100);
    return ctx;
  }

  private applyChannel(channel: AmbientChannel): void {
    const loop = this.loops.get(channel);
    if (loop == null) return;
    if (this.channelState[channel]) loop.start();
    else loop.stop();
  }

  private applyMute(): void {
    if (this.ctx == null) return;
    this.master.gain.setTargetAtTime(this.mutedState ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (ctx == null || ctx.state !== 'running') return;
    const until = ctx.currentTime + 0.3;
    for (const loop of this.loops.values()) {
      if (!loop.active) continue;
      loop.schedule(until);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    window.clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const soundEngine = new SoundEngine();
