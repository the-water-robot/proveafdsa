// Utility di naming — isomorfe (usate sia lato client che lato server).
// Nessuna dipendenza da API browser/node specifiche.

/** Data locale in formato ISO "YYYY-MM-DD". */
export function todayIso(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Nome della cartella-prova a partire da una data ISO: "2026-05-30" -> "2026 05 30". */
export function folderNameForDate(isoDate?: string): string {
  const iso = isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : todayIso();
  return iso.replace(/-/g, " ");
}

/** Orario locale "HH.mm.ss" (i punti vanno bene nei nomi file, i due punti no). */
export function timeLabel(d: Date = new Date()): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}.${m}.${s}`;
}

/** Ripulisce un segmento di nome file da caratteri problematici. */
export function sanitizeSegment(s: string): string {
  return (s || "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const MIME_EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "video/webm": "webm",
  "video/mp4": "mp4",
};

/** Estensione a partire dal mime type (con fallback ragionevole). */
export function extFromMime(mime: string): string {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  return MIME_EXT[base] || base.split("/")[1] || "bin";
}

/** Divide "idea.m4a" in { base: "idea", ext: "m4a" }. */
export function splitNameExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, i), ext: name.slice(i + 1) };
}

/**
 * Compone il nome file finale.
 * Ordine: "HH.mm.ss — chi — etichetta — base.ext" (le parti vuote sono omesse).
 * L'orario in testa tiene i file ordinati cronologicamente dentro la cartella.
 */
export function buildFileName(parts: {
  time: string;
  who?: string;
  label?: string;
  base: string;
  ext: string;
}): string {
  const segs = [parts.time, parts.who, parts.label, parts.base]
    .map((p) => (p ? sanitizeSegment(p) : ""))
    .filter(Boolean);
  const stem = segs.join(" — ") || "file";
  return parts.ext ? `${stem}.${parts.ext}` : stem;
}
