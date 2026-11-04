import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, deleteFile, errorStatus, invalidateSongs, pinOk, renameFile } from "@/lib/drive";
import { sanitizeSegment, splitNameExt } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  const message = e instanceof Error ? e.message : "Errore";
  console.error("[file]", message);
  return NextResponse.json({ error: message }, { status: errorStatus(e) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
  if (!pinOk(req.headers.get("x-pin"))) {
    return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
  }
  try {
    const info = await assertInRoot(id);
    if (info.mimeType === "application/vnd.google-apps.folder") {
      return NextResponse.json({ error: "Non si possono eliminare cartelle." }, { status: 403 });
    }
    await deleteFile(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
  if (!pinOk(req.headers.get("x-pin"))) {
    return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const raw = typeof body.name === "string" ? body.name : "";
    const { base, ext } = splitNameExt(raw);
    const clean = sanitizeSegment(base);
    if (!clean) return NextResponse.json({ error: "Nome non valido." }, { status: 400 });
    const name = ext ? `${clean}.${sanitizeSegment(ext)}` : clean;
    await assertInRoot(id);
    await renameFile(id, name);
    invalidateSongs();
    return NextResponse.json({ ok: true, name });
  } catch (e) {
    return fail(e);
  }
}
