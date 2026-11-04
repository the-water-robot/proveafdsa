import { NextRequest } from "next/server";
import {
  createResumableSession,
  ensureSessionFolder,
  ensureSubfolder,
  invalidateSongs,
  pinOk,
} from "@/lib/drive";
import { buildFileName, splitNameExt } from "@/lib/format";
import { kindOf, mimeFor } from "@/lib/mime";
import { isMember } from "@/lib/band";
import { titleFromFileName } from "@/lib/recording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint per il Comando rapido di iOS ("Carica su Prove AFdSA" dal menu Condividi, es. dai Memo Vocali).
// Il Comando manda solo il nome del file; qui si decidono data/ora (Italia), cartella e nome finale.
// Risponde in TESTO SEMPLICE con l'URL di sessione: il Comando ci fa il PUT del file (diretto a Google,
// quindi senza limiti di dimensione delle funzioni Vercel).
//
// POST /api/shortcut   body JSON: { name: "Hermano.m4a", who?: "pit", pin?: "…" }


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

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; who?: unknown; pin?: unknown };
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
    const { date, time } = romeParts();
    const fileName = buildFileName({ time, who, label, base: label ? "" : "memo", ext });

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
