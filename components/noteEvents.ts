import { chordMidi, parseChord } from "@/lib/music";
import type { MelodyNote } from "@/lib/notes";
import type { Ev } from "@/lib/synth";

export type TokEv = Ev & { token: number };

/**
 * Eventi per suonare il giro: ogni battuta (tra "|") dura 4 battiti, divisi fra i suoi accordi;
 * senza stanghette ogni accordo è una battuta. "×N" ripete il giro (o la parte da dopo l'ultimo ×).
 */
export function chordEvents(chords: string[]): TokEv[] {
  const hasBars = chords.includes("|");
  const out: TokEv[] = [];
  let beat = 0;
  let segStart = 0; // inizio della parte da ripetere (in token)
  let bar: number[] = [];
  const flush = () => {
    if (!bar.length) return;
    const each = 4 / bar.length;
    for (const t of bar) {
      out.push({ midi: chordMidi(chords[t]), beat, beats: each, strum: true, token: t });
      beat += each;
    }
    bar = [];
  };
  const run = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      const c = chords[i];
      if (c === "|") flush();
      else if (parseChord(c)) {
        bar.push(i);
        if (!hasBars) flush();
      }
    }
    flush();
  };
  for (let i = 0; i < chords.length; i++) {
    const m = /^x(\d{1,2})$/.exec(chords[i]);
    if (!m) continue;
    run(segStart, i);
    for (let r = 1; r < Math.min(8, Number(m[1])); r++) run(segStart, i);
    segStart = i + 1;
  }
  run(segStart, chords.length);
  return out;
}

export function melodyEvents(mel: MelodyNote[]): TokEv[] {
  const out: TokEv[] = [];
  let beat = 0;
  mel.forEach((n, i) => {
    if (n.p !== null) out.push({ midi: [n.p], beat, beats: n.d, token: i });
    beat += n.d;
  });
  return out;
}
