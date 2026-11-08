import { create } from 'zustand';

/**
 * Áudio do jogo, todo sintetizado no navegador (Web Audio), sem arquivos: trilha no estilo 16 bits (canais de pulso,
 * baixo, arpejo e bateria de ruído, como os chips de videogame) e efeitos (motor, semáforo, box, bandeirada).
 * As músicas são composições originais escritas em notas MIDI neste arquivo.
 *
 * Navegadores só liberam som depois de um toque ou clique: o contexto é criado no primeiro gesto do usuário e o que
 * foi pedido antes disso (ex.: a música da corrida) começa nessa hora.
 */

// ------------------------------------------------------------------ Preferências (por aparelho)
interface AudioPrefs {
  music: number; // 0..1
  sfx: number; // 0..1
  muted: boolean;
}
const PREFS_KEY = 'tracado-audio';
function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { music: 0.5, sfx: 0.7, muted: false, ...(JSON.parse(raw) as Partial<AudioPrefs>) };
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return { music: 0.5, sfx: 0.7, muted: false };
}

export const useAudioPrefs = create<AudioPrefs & { set(p: Partial<AudioPrefs>): void }>((set, get) => ({
  ...loadPrefs(),
  set(p) {
    set(p);
    const { music, sfx, muted } = { ...get(), ...p };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ music, sfx, muted }));
    } catch {
      /* ignora */
    }
    audio.applyVolumes();
  },
}));

// ------------------------------------------------------------------ Notação
/** "A4" → número MIDI (A4 = 69). Aceita sustenido (#) e bemol (b). */
function midi(n: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error(`nota inválida: ${n}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return base + acc + (Number(m[3]) + 1) * 12;
}
const freq = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** Melodia em pares [nota | null (pausa), duração em semicolcheias]. */
type Line = [string | null, number][];
/** Acorde por compasso: fundamental do baixo e notas do arpejo. */
interface Chord {
  root: string;
  arp: string[];
}
interface Section {
  chords: Chord[]; // um por compasso
  lead: Line;
}
interface Song {
  bpm: number;
  /** Ordem das seções (repete em loop). */
  order: string[];
  sections: Record<string, Section>;
  /** Padrão de bateria de 1 compasso (16 passos): k = bumbo, s = caixa, h = chimbal, - = nada. */
  drums: string;
  /** Baixo: padrão de 16 passos; 'r' = fundamental, 'o' = oitava acima, '-' = nada. */
  bass: string;
  /** Arpejo ligado? */
  arp: boolean;
  leadVolume: number;
}

const ch = (root: string, ...arp: string[]): Chord => ({ root, arp });

/** "Reta Final": tema da corrida (lá menor, 152 bpm), rock de 16 bits. Composição original. */
const RACE_SONG: Song = {
  bpm: 152,
  order: ['A', 'A2', 'B', 'A'],
  drums: 'k-h-s-h-k-k-s-hh',
  bass: 'r-r-o-r-r-r-o-r-',
  arp: true,
  leadVolume: 1,
  sections: {
    A: {
      chords: [
        ch('A2', 'A4', 'C5', 'E5'),
        ch('F2', 'F4', 'A4', 'C5'),
        ch('C3', 'C5', 'E5', 'G5'),
        ch('G2', 'G4', 'B4', 'D5'),
      ],
      lead: [
        ['E5', 4],
        ['D5', 2],
        ['C5', 2],
        ['D5', 4],
        ['E5', 4],
        ['F5', 4],
        ['E5', 2],
        ['D5', 2],
        ['C5', 6],
        ['A4', 2],
        ['G4', 2],
        ['C5', 2],
        ['E5', 4],
        ['G5', 4],
        ['E5', 4],
        ['D5', 6],
        ['B4', 2],
        ['G4', 4],
        [null, 4],
      ],
    },
    A2: {
      chords: [
        ch('F2', 'F4', 'A4', 'C5'),
        ch('G2', 'G4', 'B4', 'D5'),
        ch('E2', 'E4', 'G4', 'B4'),
        ch('A2', 'A4', 'C5', 'E5'),
      ],
      lead: [
        ['A4', 2],
        ['C5', 2],
        ['F5', 4],
        ['E5', 2],
        ['F5', 2],
        ['G5', 4],
        ['A5', 4],
        ['G5', 2],
        ['F5', 2],
        ['D5', 8],
        ['E5', 2],
        ['G5', 2],
        ['B5', 4],
        ['A5', 2],
        ['G5', 2],
        ['E5', 4],
        ['A5', 8],
        ['E5', 4],
        ['C5', 4],
      ],
    },
    B: {
      chords: [
        ch('D2', 'D4', 'F4', 'A4'),
        ch('A2', 'A4', 'C5', 'E5'),
        ch('Bb2', 'Bb4', 'D5', 'F5'),
        ch('E2', 'E4', 'G#4', 'B4'),
      ],
      lead: [
        ['D5', 2],
        ['F5', 2],
        ['A5', 4],
        ['G5', 2],
        ['F5', 2],
        ['E5', 4],
        ['C5', 2],
        ['E5', 2],
        ['A5', 8],
        ['E5', 4],
        ['D5', 2],
        ['F5', 2],
        ['Bb5', 4],
        ['A5', 2],
        ['G5', 2],
        ['F5', 4],
        ['G#5', 4],
        ['B5', 4],
        ['E6', 4],
        ['D6', 2],
        ['B5', 2],
      ],
    },
  },
};

/** "Volta Lançada": classificação, tensa e contida (mi menor, 138 bpm). Composição original. */
const QUALI_SONG: Song = {
  bpm: 138,
  order: ['Q'],
  drums: 'k---h-h-k-k-h-hh',
  bass: 'r---r-o-r---r-o-',
  arp: true,
  leadVolume: 0.6,
  sections: {
    Q: {
      chords: [
        ch('E2', 'E4', 'G4', 'B4'),
        ch('C3', 'C4', 'E4', 'G4'),
        ch('D3', 'D4', 'F#4', 'A4'),
        ch('B2', 'B3', 'D#4', 'F#4'),
      ],
      lead: [
        ['B4', 8],
        [null, 4],
        ['G4', 2],
        ['A4', 2],
        ['B4', 6],
        ['C5', 2],
        ['B4', 4],
        ['G4', 4],
        ['A4', 8],
        [null, 4],
        ['F#4', 2],
        ['G4', 2],
        ['F#4', 12],
        [null, 4],
      ],
    },
  },
};

export type MusicName = 'race' | 'quali';
const SONGS: Record<MusicName, Song> = { race: RACE_SONG, quali: QUALI_SONG };

// ------------------------------------------------------------------ Motor de áudio
class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private echo!: DelayNode;
  private noise!: AudioBuffer;
  private pulse25!: PeriodicWave;
  private pulse12!: PeriodicWave;
  private wanted: MusicName | null = null;
  playing: MusicName | null = null;
  private timer: number | null = null;
  private step = 0;
  private nextAt = 0;
  engineNodes: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private engineWanted = false;

  /** Cria o contexto no primeiro gesto do usuário (exigência dos navegadores). */
  unlock() {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return;
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      // Eco curto no canal da melodia (aquele brilho de 16 bits).
      this.echo = ctx.createDelay(1);
      this.echo.delayTime.value = 0.21;
      const fb = ctx.createGain();
      fb.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.echo.connect(fb).connect(this.echo);
      this.echo.connect(wet).connect(this.musicBus);
      // Ruído branco para bateria e efeitos.
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.pulse25 = this.pulseWave(0.25);
      this.pulse12 = this.pulseWave(0.125);
      this.applyVolumes();
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else void this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wanted && this.playing !== this.wanted) this.startMusic(this.wanted);
    if (this.engineWanted && !this.engineNodes) this.engineStart();
  }

  get ready() {
    return !!this.ctx;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const p = useAudioPrefs.getState();
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.muted ? 0 : 0.9, t, 0.05);
    // Curva quadrática: o controle fica mais natural ao ouvido.
    this.musicBus.gain.setTargetAtTime(p.music * p.music * 0.6, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(p.sfx * p.sfx, t, 0.05);
  }

  private pulseWave(duty: number): PeriodicWave {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return this.ctx!.createPeriodicWave(real, imag);
  }

  // ---------------------------------------------------------------- Música
  /** Pede uma música (toca já, ou assim que o som for liberado). null para parar. */
  music(name: MusicName | null) {
    this.wanted = name;
    if (!this.ctx) return;
    if (name === this.playing) return;
    this.stopMusic();
    if (name) this.startMusic(name);
  }

  private startMusic(name: MusicName) {
    this.stopMusic();
    this.playing = name;
    this.step = 0;
    this.nextAt = this.ctx!.currentTime + 0.1;
    // Agendador com antecedência: um intervalo curto marca as notas ~120 ms à frente (sem engasgos).
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stopMusic() {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    this.playing = null;
  }

  private schedule() {
    const ctx = this.ctx!;
    const song = SONGS[this.playing!];
    const stepDur = 60 / song.bpm / 4;
    const bars = song.order.reduce((a, s) => a + song.sections[s]!.chords.length, 0);
    const total = bars * 16;
    while (this.nextAt < ctx.currentTime + 0.12) {
      const s = this.step % total;
      this.playStep(song, s, this.nextAt, stepDur);
      this.step++;
      this.nextAt += stepDur;
    }
  }

  private playStep(song: Song, globalStep: number, t: number, stepDur: number) {
    // Localiza seção, compasso e passo.
    let bar = Math.floor(globalStep / 16);
    const inBar = globalStep % 16;
    let section: Section | null = null;
    let barInSection = 0;
    for (const name of song.order) {
      const sec = song.sections[name]!;
      if (bar < sec.chords.length) {
        section = sec;
        barInSection = bar;
        break;
      }
      bar -= sec.chords.length;
    }
    if (!section) return;
    const chord = section.chords[barInSection]!;

    // Bateria.
    const dr = song.drums[inBar];
    if (dr === 'k') this.kick(t);
    else if (dr === 's') this.snare(t);
    else if (dr === 'h') this.hat(t);
    if (dr !== 'h' && inBar % 2 === 0 && song.drums.includes('hh')) this.hat(t, 0.25);

    // Baixo.
    const b = song.bass[inBar];
    if (b === 'r' || b === 'o') this.tone(midi(chord.root) + (b === 'o' ? 12 : 0), t, stepDur * 1.6, 'bass');

    // Arpejo em semicolcheias.
    if (song.arp) {
      const n = chord.arp[inBar % chord.arp.length]!;
      this.tone(midi(n), t, stepDur * 0.8, 'arp');
    }

    // Melodia: acha a nota que começa neste passo do compasso.
    let pos = 0;
    const barStart = barInSection * 16;
    for (const [note, len] of section.lead) {
      if (pos === barStart + inBar && note)
        this.tone(midi(note), t, stepDur * len * 0.92, 'lead', song.leadVolume);
      pos += len;
      if (pos > barStart + inBar) break;
    }
  }

  private tone(note: number, t: number, dur: number, kind: 'lead' | 'bass' | 'arp', vol = 1) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = freq(note);
    if (kind === 'lead') {
      osc.setPeriodicWave(this.pulse25);
      // Vibrato leve nas notas longas.
      if (dur > 0.3) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(f * 0.012, t + 0.25);
        lfo.connect(depth).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      }
    } else if (kind === 'arp') osc.setPeriodicWave(this.pulse12);
    else {
      osc.type = 'sawtooth';
    }
    osc.frequency.setValueAtTime(f, t);
    const peak = (kind === 'lead' ? 0.16 : kind === 'bass' ? 0.2 : 0.05) * vol;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.setTargetAtTime(peak * (kind === 'lead' ? 0.7 : 0.4), t + 0.02, 0.08);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    let out: AudioNode = g;
    if (kind === 'bass') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      g.connect(lp);
      out = lp;
    }
    osc.connect(g);
    out.connect(this.musicBus);
    if (kind === 'lead') g.connect(this.echo);
    osc.start(t);
    osc.stop(t + dur + 0.2);
  }

  private noiseHit(t: number, dur: number, type: BiquadFilterType, hz: number, vol: number, bus: GainNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.2);
  }
  private snare(t: number) {
    this.noiseHit(t, 0.16, 'bandpass', 1800, 0.32, this.musicBus);
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.1);
  }
  private hat(t: number, vol = 0.5) {
    this.noiseHit(t, 0.04, 'highpass', 7000, 0.12 * vol, this.musicBus);
  }

  // ---------------------------------------------------------------- Efeitos
  /** Bipe do semáforo; `go` = luzes apagando (largada). */
  lights(go: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(this.pulse25);
    osc.frequency.value = go ? 880 : 440;
    const dur = go ? 0.45 : 0.14;
    g.gain.setValueAtTime(0.22, t);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.2);
  }

  /** Parada no box: rajadas da parafusadeira pneumática. */
  pit() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.13, 0.09, 'bandpass', 3200, 0.35, this.sfxBus);
  }

  /** Toque entre carros: pancada grave seguida de lataria raspando. */
  crash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, 0.18, 'lowpass', 600, 0.5, this.sfxBus);
    this.noiseHit(t + 0.06, 0.25, 'bandpass', 2400, 0.22, this.sfxBus);
  }

  /** Bandeirada: vinheta curta (arpejo maior subindo). */
  finish() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    ['C5', 'E5', 'G5', 'C6', 'G5', 'C6'].forEach((n, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.setPeriodicWave(this.pulse25);
      osc.frequency.value = freq(midi(n));
      const at = t + i * 0.11;
      const dur = i === 5 ? 0.6 : 0.1;
      g.gain.setValueAtTime(0.18, at);
      g.gain.setTargetAtTime(0, at + dur, 0.05);
      osc.connect(g).connect(this.sfxBus);
      osc.start(at);
      osc.stop(at + dur + 0.3);
    });
  }

  /** Clique curto de interface. */
  blip() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(this.pulse12);
    osc.frequency.setValueAtTime(1320, t);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  /** Liga/desliga o som do motor (do carro em foco). */
  engine(on: boolean) {
    this.engineWanted = on;
    if (!this.ctx) return;
    if (on && !this.engineNodes) this.engineStart();
    if (!on && this.engineNodes) {
      const { osc, gain } = this.engineNodes;
      const t = this.ctx.currentTime;
      gain.gain.setTargetAtTime(0, t, 0.08);
      osc.forEach((o) => o.stop(t + 0.5));
      this.engineNodes = null;
    }
  }

  private engineStart() {
    const ctx = this.ctx!;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth';
    b.setPeriodicWave(this.pulse25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.sfxBus);
    a.start();
    b.start();
    this.engineNodes = { osc: [a, b], filter, gain };
    this.engineSpeed(0);
  }

  /**
   * Rotação do motor pela velocidade (0..1): o tom sobe com a velocidade e "troca de marcha" a cada faixa,
   * como os jogos de corrida de 16 bits. `active` = carro andando (parado no box ou abandonado = silêncio).
   */
  engineSpeed(v: number, active = true) {
    if (!this.ctx || !this.engineNodes) return;
    const t = this.ctx.currentTime;
    const x = Math.max(0, Math.min(1, v));
    const gears = 5;
    const g = Math.min(gears - 1, Math.floor(x * gears));
    const inGear = x * gears - g;
    const rpm = 0.35 + 0.65 * inGear; // sobe dentro da marcha e cai na troca
    const base = 55 + g * 9 + rpm * 70;
    const [a, b] = this.engineNodes.osc as [OscillatorNode, OscillatorNode];
    a.frequency.setTargetAtTime(base, t, 0.05);
    b.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    this.engineNodes.filter.frequency.setTargetAtTime(350 + x * 1600, t, 0.08);
    this.engineNodes.gain.gain.setTargetAtTime(active ? 0.07 + x * 0.06 : 0, t, 0.1);
  }
}

export const audio = new AudioEngine();
// Só em desenvolvimento: inspecionar o áudio pelo console.
if (import.meta.env?.DEV && typeof window !== 'undefined')
  (window as unknown as { __audio: AudioEngine }).__audio = audio;

/** Para testes: partituras e conversão de notas. */
export const __music = { songs: SONGS, midi, freq };

/** Liga o desbloqueio do som no primeiro gesto (chamado uma vez no início do app). */
export function installAudioUnlock() {
  if (typeof document === 'undefined') return;
  const go = () => audio.unlock();
  document.addEventListener('pointerdown', go, { passive: true });
  document.addEventListener('keydown', go);
}
