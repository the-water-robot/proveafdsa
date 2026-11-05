// Teoria minima per gli appunti — isomorfo (client + server).
// Notazione accordi anglosassone, come nel canzoniere (G, Em, F#m7…).

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const KEY_ROOTS = ["C", "C#", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const CHORD_ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** Qualità degli accordi proposte nel costruttore (simbolo → intervalli in semitoni). */
export const QUALITIES: { s: string; label: string; iv: number[] }[] = [
  { s: "", label: "maj", iv: [0, 4, 7] },
  { s: "m", label: "m", iv: [0, 3, 7] },
  { s: "7", label: "7", iv: [0, 4, 7, 10] },
  { s: "m7", label: "m7", iv: [0, 3, 7, 10] },
  { s: "maj7", label: "maj7", iv: [0, 4, 7, 11] },
  { s: "sus4", label: "sus4", iv: [0, 5, 7] },
  { s: "sus2", label: "sus2", iv: [0, 2, 7] },
  { s: "add9", label: "add9", iv: [0, 4, 7, 14] },
  { s: "6", label: "6", iv: [0, 4, 7, 9] },
  { s: "9", label: "9", iv: [0, 4, 7, 10, 14] },
  { s: "dim", label: "dim", iv: [0, 3, 6] },
  { s: "m7b5", label: "m7♭5", iv: [0, 3, 6, 10] },
  { s: "aug", label: "aug", iv: [0, 4, 8] },
  { s: "5", label: "5 (power)", iv: [0, 7, 12] },
];

/** Pitch class (0-11) di un nome tipo "F#", "Bb". */
export function pcOf(name: string): number | null {
  const m = /^([A-G])([#b]?)/.exec(name);
  if (!m) return null;
  return (LETTER_PC[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
}

export function spell(pc: number, flats: boolean): string {
  return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];
}

export interface Chord {
  root: number;
  quality: string;
  bass: number | null;
}

/** "F#m7/C#" → {root: 6, quality: "m7", bass: 1}. Null se non è un accordo. */
export function parseChord(sym: string): Chord | null {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym.trim());
  if (!m) return null;
  return { root: pcOf(m[1])!, quality: m[2], bass: m[3] ? pcOf(m[3]) : null };
}

function intervalsFor(q: string): number[] {
  const exact = QUALITIES.find((x) => x.s === q);
  if (exact) return exact.iv;
  // varianti comuni non in lista
  if (/^(m|min|-)/.test(q) && !q.startsWith("maj")) return q.includes("7") ? [0, 3, 7, 10] : [0, 3, 7];
  if (q.startsWith("maj")) return [0, 4, 7, 11];
  if (q.includes("dim") || q.includes("°")) return [0, 3, 6];
  if (q.includes("sus")) return [0, 5, 7];
  if (q.includes("7")) return [0, 4, 7, 10];
  return [0, 4, 7];
}

/** Note MIDI per suonare l'accordo (basso + voicing intorno al Do centrale). */
export function chordMidi(sym: string): number[] {
  const c = parseChord(sym);
  if (!c) return [];
  const base = 48 + c.root + (c.root > 7 ? -12 : 0);
  const notes = intervalsFor(c.quality).map((i) => base + 12 + i);
  const bass = 36 + (c.bass ?? c.root) + ((c.bass ?? c.root) > 7 ? -12 : 0) + 12;
  return [bass, ...notes];
}

export function isMinorQuality(q: string): boolean {
  return /^(m(?!aj)|min|-)/.test(q) || q.includes("dim") || q.includes("°");
}

/** Tonalità tipo "Bb" o "F#m" → tonica e modo. */
export function parseKey(key: string): { pc: number; minor: boolean } | null {
  const m = /^([A-G][#b]?)(m?)$/.exec(key || "");
  if (!m) return null;
  return { pc: pcOf(m[1])!, minor: m[2] === "m" };
}

/** Le tonalità "coi bemolli" si scrivono coi bemolli (Bb, Eb…), le altre coi diesis. */
export function prefersFlats(key: string): boolean {
  const k = parseKey(key);
  if (!k) return false;
  const major = k.minor ? (k.pc + 3) % 12 : k.pc;
  if (/b/.test(key.slice(1))) return true;
  return [5, 10, 3, 8, 1].includes(major); // F Bb Eb Ab Db
}

/** Trasporta un simbolo di `n` semitoni. */
export function transposeChord(sym: string, n: number, flats: boolean): string {
  const c = parseChord(sym);
  if (!c) return sym;
  return spell(c.root + n, flats) + c.quality + (c.bass !== null ? "/" + spell(c.bass + n, flats) : "");
}

const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEYS = ["Cm", "C#m", "Dm", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];

/** Trasporta la tonalità, scrivendola nel modo più comune (Bb, non A#). */
export function transposeKey(key: string, n: number): string {
  const k = parseKey(key);
  if (!k) return key;
  const pc = (((k.pc + n) % 12) + 12) % 12;
  return k.minor ? MINOR_KEYS[pc] : MAJOR_KEYS[pc];
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
// semitoni dalla tonica → [grado 0-6, alterazione]
const DEG_MAJOR: [number, string][] = [
  [0, ""], [1, "♭"], [1, ""], [2, "♭"], [2, ""], [3, ""], [3, "♯"], [4, ""], [5, "♭"], [5, ""], [6, "♭"], [6, ""],
];
const DEG_MINOR: [number, string][] = [
  [0, ""], [1, "♭"], [1, ""], [2, ""], [2, "♯"], [3, ""], [4, "♭"], [4, ""], [5, ""], [5, "♯"], [6, ""], [6, "♯"],
];

/** Grado dell'accordo nella tonalità: "vi", "IV", "V7", "ii°"… */
export function degreeOf(sym: string, key: string): string | null {
  const c = parseChord(sym);
  const k = parseKey(key);
  if (!c || !k) return null;
  const [deg, acc] = (k.minor ? DEG_MINOR : DEG_MAJOR)[(c.root - k.pc + 12) % 12];
  let r = ROMAN[deg];
  if (isMinorQuality(c.quality)) r = r.toLowerCase();
  const suffix = c.quality.includes("dim") ? "°" : c.quality.includes("m7b5") ? "ø" : c.quality.includes("7") ? "7" : "";
  return acc + r + suffix;
}

/** Accordi della tonalità, in ordine di grado (per scegliere al volo). */
export function diatonicChords(key: string): string[] {
  const k = parseKey(key);
  if (!k) return [];
  const flats = prefersFlats(key);
  const steps: [number, string][] = k.minor
    ? [[0, "m"], [2, "dim"], [3, ""], [5, "m"], [7, "m"], [8, ""], [10, ""], [7, ""]] // + V maggiore
    : [[0, ""], [2, "m"], [4, "m"], [5, ""], [7, ""], [9, "m"], [11, "dim"], [7, "7"]]; // + V7
  return steps.map(([iv, q]) => spell(k.pc + iv, flats) + q);
}

/* ───────────── Melodia ───────────── */

export const DURATIONS = [0.5, 1, 2, 4] as const; // croma, semiminima, minima, semibreve (in battiti)
export const DURATION_NAMES: Record<number, string> = {
  0.25: "semicroma",
  0.5: "croma",
  0.75: "croma puntata",
  1: "semiminima",
  1.5: "semiminima puntata",
  2: "minima",
  3: "minima puntata",
  4: "semibreve",
};

export function midiName(midi: number, flats = false, withOctave = false): string {
  return spell(midi % 12, flats) + (withOctave ? String(Math.floor(midi / 12) - 1) : "");
}

const SOLFEGE = ["Do", "Do♯", "Re", "Mi♭", "Mi", "Fa", "Fa♯", "Sol", "La♭", "La", "Si♭", "Si"];
export function solfege(midi: number): string {
  return SOLFEGE[midi % 12];
}

export function midiFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Posizione sul pentagramma in chiave di violino: "gradino" diatonico (Mi4 = riga in basso = 0)
 * e alterazione da disegnare.
 */
export function staffPos(midi: number, flats: boolean): { step: number; acc: "" | "♯" | "♭" } {
  const name = spell(midi % 12, flats);
  const letter = "CDEFGAB".indexOf(name[0]);
  const octave = Math.floor(midi / 12) - 1;
  const step = octave * 7 + letter - (4 * 7 + 2);
  return { step, acc: name[1] === "#" ? "♯" : name[1] === "b" ? "♭" : "" };
}
