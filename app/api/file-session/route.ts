import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, createResumableUpdateSession, errorStatus, pinOk } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea una sessione di upload resumable per sovrascrivere il contenuto di un file Drive esistente.
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mimeType?: string;
      newName?: string;
      origin?: string;
      pin?: string;
    };
    if (!pinOk(body.pin)) {
      return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
    }
    await assertInRoot(id);
    const origin = body.origin || req.headers.get("origin") || undefined;
    const sessionUrl = await createResumableUpdateSession(
      id,
      body.mimeType || "audio/wav",
      body.newName,
      origin,
    );
    return NextResponse.json({ sessionUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Errore";
    console.error("[file-session]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(e) });
  }
}
