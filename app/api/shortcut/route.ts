import { NextRequest } from "next/server";
import {
  createResumableSession,
  ensureSessionFolder,
  ensureSubfolder,
  invalidateSongs,
  listRehearsalFolders,
  pinOk,
} from "@/lib/drive";
import { buildFileName, folderNameForDate, prettyFolderDate, splitNameExt } from "@/lib/format";
import { kindOf, mimeFor } from "@/lib/mime";
import { isMember } from "@/lib/band";
import { titleFromFileName } from "@/lib/recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint per il Comando rapido di iOS ("Carica su Prove AFdSA" dal menu Condividi, es. dai Memo Vocali).
//
// GET  /api/shortcut          → elenco JSON per il menu "Di che prova è?":
//                               Oggi, Ieri e le ultime prove. Serve perché i Memo Vocali, condividendo,
//                               creano una copia con la data di ADESSO: la data vera la sceglie chi carica.
// POST /api/shortcut          body JSON { name, date?, who?, pin? }  (date = riga scelta dal menu o "YYYY-MM-DD")
//                             → TESTO con l'URL di sessione: il Comando ci fa il PUT del file
//                               (diretto a Google, quindi senza limiti di dimensione delle funzioni Vercel).

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

function romeParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}.${p.minute}.${p.second}` };
}

/** "Ieri · martedì 3 novembre 2026" / "2026-11-03" → "2026-11-03" (null se non riconosciuta). */
function parseChoice(s: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join("|")})\\s+(\\d{4})`, "i").exec(s);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function GET() {
  const today = romeParts().date;
  const yesterday = romeParts(new Date(Date.now() - 86400000)).date;
  const label = (iso: string) => prettyFolderDate(folderNameForDate(iso));
  const lines = [`Oggi · ${label(today)}`, `Ieri · ${label(yesterday)}`];
  try {
    for (const f of (await listRehearsalFolders()).slice(0, 12)) {
      const iso = f.name.replace(/ /g, "-");
      if (iso !== today && iso !== yesterday && lines.length < 10) lines.push(`Prova di ${label(iso)}`);
    }
  } catch {
    /* senza Drive: almeno oggi e ieri */
  }
  // array JSON: Comandi lo trasforma direttamente in lista per "Scegli dall'elenco"
  return Response.json(lines);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      date?: unknown;
      who?: unknown;
      pin?: unknown;
    };
    if (!pinOk(body.pin)) return text("ERRORE: codice di accesso errato", 401);

    const raw = (typeof body.name === "string" ? body.name : "").trim() || "memo";
    let { base, ext } = splitNameExt(raw);
    // "Ottieni nome" di Comandi a volte toglie l'estensione: i Memo Vocali sono m4a
    if (!ext || ext.length > 5) {
      base = raw;
      ext = "m4a";
    }
    const who = typeof body.who === "string" && isMember(body.who) ? body.who.toLowerCase() : "";
    const label = titleFromFileName(base); // "Nuova registrazione 12" → nessun titolo
    const now = romeParts();
    const date = (typeof body.date === "string" && parseChoice(body.date)) || now.date;
    const fileName = buildFileName({ time: now.time, who, label, base: label ? "" : "memo", ext });

    const kind = kindOf(`x.${ext}`);
    const folder = await ensureSessionFolder(date);
    const target =
      kind === "video" ? await ensureSubfolder(folder.id, "video")
      : kind === "image" ? await ensureSubfolder(folder.id, "foto")
      : folder.id;
    const sessionUrl = await createResumableSession(target, fileName, mimeFor(fileName));
    invalidateSongs();
    return text(sessionUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "errore";
    console.error("[shortcut]", message);
    return text(`ERRORE: ${message}`, 500);
  }
}
