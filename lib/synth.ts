// Sintetizzatore minimo (Web Audio) per riascoltare gli appunti — solo CLIENT.
import { chordMidi, midiFreq } from "./music";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const live = new Set<OscillatorNode>();

function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Una nota "pizzicata": triangolo + un filo di dente di sega filtrato, inviluppo morbido. */
function tone(midi: number, start: number, dur: number, vol = 0.22) {
  const ac = audio();
  const f = midiFreq(midi);
  const g = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(6000, f * 6);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
  g.gain.exponentialRampToValueAtTime(vol * 0.45, start + Math.min(0.35, dur * 0.6));
  g.gain.setValueAtTime(vol * 0.45, start + Math.max(0.02, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur + 0.12);
  filter.connect(g).connect(master!);
  for (const [type, level] of [["triangle", 1], ["sawtooth", 0.18]] as const) {
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = type;
    o.frequency.value = f;
    og.gain.value = level;
    o.connect(og).connect(filter);
    o.start(start);
    o.stop(start + dur + 0.15);
    live.add(o);
    o.onended = () => live.delete(o);
  }
}

/** Ferma tutto quello che sta suonando. */
export function stopAll() {
  for (const o of live) {
    try {
      o.stop();
    } catch {
      /* già fermo */
    }
  }
  live.clear();
}

/** Suona una nota subito (feedback del tasto). */
export function blip(midi: number, dur = 0.35) {
  tone(midi, audio().currentTime + 0.005, dur);
}

/** Suona un accordo subito, leggermente arpeggiato come una pennata. */
export function strum(sym: string, dur = 1.2) {
  const t = audio().currentTime + 0.01;
  chordMidi(sym).forEach((m, i) => tone(m, t + i * 0.018, dur, i === 0 ? 0.2 : 0.13));
}

export interface Ev {
  midi: number[];
  beat: number; // inizio in battiti
  beats: number; // durata in battiti
  strum?: boolean;
}

/**
 * Suona una sequenza di eventi a `bpm`. `onBeat(i)` viene chiamato quando parte l'evento i
 * (per evidenziarlo), `onEnd` alla fine. Ritorna una funzione per fermare.
 */
export function playSequence(events: Ev[], bpm: number, onStep?: (i: number) => void, onEnd?: () => void): () => void {
  stopAll();
  const ac = audio();
  const spb = 60 / bpm;
  const t0 = ac.currentTime + 0.08;
  const timers: number[] = [];
  events.forEach((e, i) => {
    const start = t0 + e.beat * spb;
    const dur = Math.max(0.08, e.beats * spb * 0.95);
    e.midi.forEach((m, j) => tone(m, start + (e.strum ? j * 0.018 : 0), dur, e.strum ? (j === 0 ? 0.2 : 0.13) : 0.24));
    timers.push(window.setTimeout(() => onStep?.(i), Math.max(0, (start - ac.currentTime) * 1000)));
  });
  const last = events.reduce((n, e) => Math.max(n, e.beat + e.beats), 0);
  timers.push(window.setTimeout(() => onEnd?.(), Math.max(0, (t0 + last * spb - ac.currentTime) * 1000) + 150));
  return () => {
    timers.forEach(clearTimeout);
    stopAll();
    onEnd?.();
  };
}
