// Costanti e tipi della band — isomorfo (client + server). Niente dipendenze browser/node.

export const MEMBERS = ["pit", "dave", "marce", "brivido", "corra"] as const;
export type Member = (typeof MEMBERS)[number];

// Strumento di ciascuno (Unicode non ha un'emoji del basso: 🎻 fa da contrabbasso)
export const INSTRUMENT: Record<Member, { emoji: string; label: string }> = {
  pit: { emoji: "🎤", label: "voce" },
  dave: { emoji: "🎸", label: "chitarra" },
  marce: { emoji: "🥁", label: "batteria" },
  brivido: { emoji: "🎺", label: "tromba" },
  corra: { emoji: "🎻", label: "basso" },
};

export function isMember(s: string): s is Member {
  return (MEMBERS as readonly string[]).includes(s.toLowerCase());
}

/** "pit" → "🎤 Pit" (nomi non in band: solo maiuscola iniziale). */
export function memberLabel(name: string): string {
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  const key = name.toLowerCase();
  return isMember(key) ? `${INSTRUMENT[key as Member].emoji} ${cap}` : cap;
}

export const MOODS = [
  { id: "top6", label: "Top 6", emoji: "🔥" },
  { id: "mirabilantiavventure", label: "Mirabilanti Avventure", emoji: "🗺️" },
  { id: "pesciato", label: "Pesciato", emoji: "🐟" },
  { id: "carichi-sempre", label: "Carichi Sempre", emoji: "⚡" },
] as const;
export type MoodId = (typeof MOODS)[number]["id"];

export interface ProvaMeta {
  version: 1;
  paidRehearsal: { who: string | null; amount: number | null }; // un pagatore + importo €
  beers: string[]; // chi ha comprato le birre (senza importo)
  present: string[]; // membri presenti
  mood: string | null; // un id da MOODS
  notes: string;
  updatedAt: string; // ISO
}

export function defaultMeta(): ProvaMeta {
  return {
    version: 1,
    paidRehearsal: { who: null, amount: null },
    beers: [],
    present: [],
    mood: null,
    notes: "",
    updatedAt: new Date().toISOString(),
  };
}

export function moodById(id: string | null | undefined) {
  return MOODS.find((m) => m.id === id) ?? null;
}

/** Normalizza/valida un metadato in ingresso (usato lato server prima di salvare). */
export function sanitizeMeta(input: unknown): ProvaMeta {
  const obj = (input ?? {}) as Record<string, unknown>;
  const memberSet = new Set<string>(MEMBERS);
  const moodSet = new Set<string>(MOODS.map((m) => m.id));

  const onlyMembers = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? Array.from(new Set(arr.filter((x): x is string => typeof x === "string" && memberSet.has(x))))
      : [];

  const paid = (obj.paidRehearsal ?? {}) as Record<string, unknown>;
  const whoRaw = paid.who;
  const amountRaw = paid.amount;
  const amountNum = Number(amountRaw);
  const amount =
    amountRaw === null || amountRaw === undefined || amountRaw === "" || !Number.isFinite(amountNum)
      ? null
      : Math.max(0, Math.round(amountNum * 100) / 100);

  return {
    version: 1,
    paidRehearsal: {
      who: typeof whoRaw === "string" && memberSet.has(whoRaw) ? whoRaw : null,
      amount,
    },
    beers: onlyMembers(obj.beers),
    present: onlyMembers(obj.present),
    mood: typeof obj.mood === "string" && moodSet.has(obj.mood) ? obj.mood : null,
    notes: typeof obj.notes === "string" ? obj.notes.slice(0, 2000) : "",
    updatedAt: new Date().toISOString(),
  };
}
