// Appunti musicali della prova — isomorfo (client + server). Salvati in "_appunti.json" nella cartella.
import { parseChord } from "./music";

export type NoteKind = "chords" | "melody" | "text";

export interface MelodyNote {
  p: number | null; // nota MIDI (60 = Do centrale), null = pausa
  d: number; // durata in battiti (1 = semiminima)
}

export interface MusicNote {
  id: string;
  kind: NoteKind;
  song: string; // pezzo (facoltativo)
  section: string; // Strofa, Rit… (facoltativo)
  who: string;
  text: string; // testo libero / commento
  chords: string[]; // simboli accordo e "|" come stanghetta
  melody: MelodyNote[];
  key: string; // tonalità, es. "G" o "Em"
  bpm: number;
  created: number;
  updated: number;
}

export const NOTES_FILE = "_appunti.json";

export const KINDS: { id: NoteKind; label: string; emoji: string; hint: string }[] = [
  { id: "chords", label: "Accordi", emoji: "🎸", hint: "giro, progressione" },
  { id: "melody", label: "Melodia", emoji: "🎼", hint: "riff, linea, tema" },
  { id: "text", label: "Testo", emoji: "✍️", hint: "idee, parole, struttura" },
];

export const SECTIONS = ["Intro", "Strofa", "Pre-rit", "Rit", "Bridge", "Solo", "Riff", "Outro"];

const DUR_OK = new Set([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);

export function newNote(kind: NoteKind, extra: Partial<MusicNote> = {}): MusicNote {
  const now = Date.now();
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    kind,
    song: "",
    section: "",
    who: "",
    text: "",
    chords: [],
    melody: [],
    key: "",
    bpm: 90,
    created: now,
    updated: now,
    ...extra,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Valida un appunto arrivato dal client (o letto da Drive). Null se non valido. */
export function sanitizeNote(x: unknown): MusicNote | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind === "chords" || o.kind === "melody" || o.kind === "text" ? o.kind : null;
  const id = str(o.id, 40);
  if (!kind || !/^[a-z0-9]{4,40}$/i.test(id)) return null;
  const chords = Array.isArray(o.chords)
    ? o.chords
        .filter((c): c is string => typeof c === "string" && (c === "|" || /^x\d{1,2}$/.test(c) || !!parseChord(c)))
        .map((c) => c.slice(0, 16))
        .slice(0, 400)
    : [];
  const melody = Array.isArray(o.melody)
    ? o.melody
        .map((n) => n as { p?: unknown; d?: unknown })
        .filter((n) => n && DUR_OK.has(Number(n.d)))
        .map((n) => ({
          p: n.p === null ? null : Math.round(Math.min(108, Math.max(21, Number(n.p) || 60))),
          d: Number(n.d),
        }))
        .slice(0, 600)
    : [];
  const bpm = Math.round(Number(o.bpm));
  const now = Date.now();
  return {
    id,
    kind,
    song: str(o.song, 120).trim(),
    section: str(o.section, 40).trim(),
    who: str(o.who, 40).toLowerCase(),
    text: str(o.text, 5000),
    chords,
    melody,
    key: /^[A-G][#b]?m?$/.test(str(o.key, 4)) ? str(o.key, 4) : "",
    bpm: bpm >= 30 && bpm <= 300 ? bpm : 90,
    created: Number(o.created) || now,
    updated: Number(o.updated) || now,
  };
}

export function isEmptyNote(n: MusicNote): boolean {
  return !n.text.trim() && !n.chords.some((c) => c !== "|") && !n.melody.length;
}
