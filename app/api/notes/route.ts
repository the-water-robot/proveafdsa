import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, ensureSessionFolder, errorStatus, pinOk, readNotes, updateNotes } from "@/lib/drive";
import { isEmptyNote, sanitizeNote } from "@/lib/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder");
  if (!folder) return NextResponse.json({ error: "Parametro 'folder' mancante." }, { status: 400 });
  try {
    await assertInRoot(folder);
    return NextResponse.json({ notes: await readNotes(folder) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[notes GET]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}

/**
 * POST { folder | date, pin, op: "save", note }  → crea/aggiorna un appunto
 * POST { folder, pin, op: "delete", id }          → elimina un appunto
 * `date` (YYYY-MM-DD) serve dalla pagina Carica: la cartella della prova viene creata se manca.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!pinOk(body?.pin)) {
      return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
    }

    let folderId: string;
    if (typeof body?.folder === "string" && body.folder) {
      folderId = body.folder;
      await assertInRoot(folderId);
    } else if (typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      folderId = (await ensureSessionFolder(body.date)).id;
    } else {
      return NextResponse.json({ error: "Manca la prova (folder o date)." }, { status: 400 });
    }

    if (body.op === "delete") {
      const id = String(body.id || "");
      const notes = await updateNotes(folderId, (ns) => ns.filter((n) => n.id !== id));
      return NextResponse.json({ notes, folder: folderId });
    }

    const note = sanitizeNote(body?.note);
    if (!note) return NextResponse.json({ error: "Appunto non valido." }, { status: 400 });
    if (isEmptyNote(note)) return NextResponse.json({ error: "L'appunto è vuoto." }, { status: 400 });
    note.updated = Date.now();
    const notes = await updateNotes(folderId, (ns) => {
      const i = ns.findIndex((n) => n.id === note.id);
      if (i < 0) return [...ns, note];
      const copy = ns.slice();
      copy[i] = { ...note, created: ns[i].created };
      return copy;
    });
    return NextResponse.json({ notes, folder: folderId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[notes POST]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
