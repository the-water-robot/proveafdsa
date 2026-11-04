// Lettura dei nomi file delle registrazioni — isomorfo (client + server).
// Formato: "HH.mm.ss — chi — etichetta — base.ext" (le parti vuote sono omesse).
import { isMember, memberLabel } from "./band";
import { splitNameExt } from "./format";
import { REPERTOIRE, type RepertoireSong } from "./repertoire";

const TIME_RE = /^\d{2}\.\d{2}\.\d{2}$/;
const GENERIC_RE = /^(prova|video|foto|file|memo|condiviso.*|registrazione.*|new recording.*|audio)$/i;

function parts(name: string): string[] {
  const base = splitNameExt(name).base || name;
  return base.split(" — ").map((p) => p.trim()).filter(Boolean);
}

/** "22.19.35 — pit — Rosa — prova.webm" → "Rosa" */
export function songTitle(name: string): string {
  const p = parts(name);
  // solo orario (+ autore) + nome generico → nessuna etichetta
  if (TIME_RE.test(p[0] ?? "") && !labelOf(name)) return "Senza nome 🤷";
  if (p.length > 1 && TIME_RE.test(p[0])) p.shift();
  if (p.length > 1 && GENERIC_RE.test(p[p.length - 1])) p.pop();
  if (p.length > 1 && isMember(p[0])) p.shift();
  return p.join(" — ") || splitNameExt(name).base || name;
}

/** Etichetta "vera" (senza orario, autore e nome generico), o "" se non c'è. */
export function labelOf(name: string): string {
  const p = parts(name);
  if (p.length && TIME_RE.test(p[0])) p.shift();
  if (p.length && isMember(p[0])) p.shift();
  if (p.length && GENERIC_RE.test(p[p.length - 1])) p.pop();
  return p.join(" — ");
}

/** Chi ha registrato (con emoji dello strumento), se il nome lo contiene. */
export function recordedBy(name: string): string {
  const p = parts(name);
  const i = TIME_RE.test(p[0] ?? "") ? 1 : 0;
  return p.length > i + 1 && isMember(p[i]) ? memberLabel(p[i]) : "";
}

/** "22.19.35 — …" → "ore 22:19" */
export function recordedAt(name: string): string {
  const m = /^(\d{2})\.(\d{2})\.\d{2}\b/.exec(name);
  return m ? `ore ${m[1]}:${m[2]}` : "";
}

/** Nomi file automatici (registratori, WhatsApp, fotocamere…): non sono un titolo di pezzo. */
const AUTO_NAME =
  /^(nuova registrazione|new recording|registrazione|recording|rec[\s_-]|voice|audio|aud[-_]|ptt[-_]|img[-_]|vid[-_]|pxl[-_]|dsc|mvi|video|foto|photo|memo|condiviso|file|untitled|senza titolo|\d)/i;

/** Titolo del pezzo ricavato dal nome di un file scelto/condiviso, o "" se è un nome automatico. */
export function titleFromFileName(base: string): string {
  if (!base.trim() || AUTO_NAME.test(base.trim())) return "";
  const t = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 60 ? "" : t;
}

/* ─── Etichette rapide (sempre disponibili, oltre ai pezzi del repertorio) ─── */
export const QUICK_LABELS = [
  { label: "soundcheck", emoji: "🎚️" },
  { label: "jam", emoji: "🌀" },
  { label: "idea nuova", emoji: "💡" },
  { label: "riff", emoji: "🔁" },
  { label: "take buona", emoji: "🔥" },
] as const;

/* ─── Collegamento al canzoniere ─── */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Trova la canzone del canzoniere a cui si riferisce un'etichetta (anche abbreviata o con aggiunte). */
export function findSong(label: string): RepertoireSong | null {
  const l = normalize(label);
  if (l.length < 3) return null;
  const exact = REPERTOIRE.find((s) => normalize(s.title) === l);
  if (exact) return exact;
  // "Goodbye col jazz" → Goodbye · "Allegro stonato 2" → Allegro Stonato
  const longer = REPERTOIRE.filter((s) => l.startsWith(normalize(s.title) + " "));
  if (longer.length) return longer.sort((a, b) => b.title.length - a.title.length)[0];
  // "Birretta" → Birretta Fresca · "Antonio" → Antonio, il Vichingo (solo se non ambiguo)
  if (l.length >= 4) {
    const prefix = REPERTOIRE.filter((s) => normalize(s.title).startsWith(l));
    if (prefix.length === 1) return prefix[0];
    const first = l.split(" ")[0];
    if (first.length >= 4) {
      const byWord = REPERTOIRE.filter((s) => normalize(s.title).split(" ")[0] === first);
      if (byWord.length === 1) return byWord[0];
    }
  }
  return null;
}

export interface LabelSuggestion {
  title: string;
  emoji?: string;
  song?: RepertoireSong; // presente se è un pezzo del canzoniere
}

/**
 * Suggerimenti ordinati: prima i pezzi usati di recente (ricondotti al titolo del canzoniere
 * quando possibile), poi il resto del canzoniere. `extra` = titoli di lavoro non nel canzoniere.
 */
export function rankSuggestions(recent: { title: string }[]): {
  ranked: LabelSuggestion[];
  canzoniere: LabelSuggestion[];
  extra: LabelSuggestion[];
  recentCount: number; // i primi `recentCount` di `ranked` vengono dalle prove recenti
} {
  const seen = new Set<string>();
  const ranked: LabelSuggestion[] = [];
  const extra: LabelSuggestion[] = [];
  for (const r of recent) {
    const song = findSong(r.title);
    const s: LabelSuggestion = song ? { title: song.title, emoji: song.emoji, song } : { title: r.title };
    const k = normalize(s.title);
    if (seen.has(k)) continue;
    seen.add(k);
    ranked.push(s);
    if (!song) extra.push(s);
  }
  const recentCount = ranked.length;
  const canzoniere: LabelSuggestion[] = REPERTOIRE.map((song) => ({ title: song.title, emoji: song.emoji, song }));
  for (const c of canzoniere) {
    const k = normalize(c.title);
    if (!seen.has(k)) {
      seen.add(k);
      ranked.push(c);
    }
  }
  return { ranked, canzoniere, extra, recentCount };
}

/** Cambia solo l'etichetta di un nome file, mantenendo orario, autore, nome generico ed estensione. */
export function relabel(name: string, label: string): string {
  const { ext } = splitNameExt(name);
  const p = parts(name);
  const time = p.length && TIME_RE.test(p[0]) ? p.shift()! : "";
  const who = p.length > 1 && isMember(p[0]) ? p.shift()! : "";
  const base = p.length && GENERIC_RE.test(p[p.length - 1]) ? p.pop()! : "";
  const segs = [time, who, label.trim(), base].filter(Boolean);
  const stem = segs.join(" — ") || splitNameExt(name).base;
  return ext ? `${stem}.${ext}` : stem;
}
