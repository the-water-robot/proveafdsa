import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, pinOk, readMeta, writeMeta } from "@/lib/drive";
import { sanitizeMeta } from "@/lib/band";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ error: "Parametro 'folder' mancante." }, { status: 400 });
  }
  try {
    await assertInRoot(folder);
    const meta = await readMeta(folder);
    return NextResponse.json({ meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[meta GET]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (!pinOk(body?.pin)) {
      return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
    }

    const folder = body?.folder;
    if (!folder || typeof folder !== "string") {
      return NextResponse.json({ error: "Parametro 'folder' mancante." }, { status: 400 });
    }

    await assertInRoot(folder);
    const meta = sanitizeMeta(body?.meta);
    await writeMeta(folder, meta);
    return NextResponse.json({ ok: true, meta });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[meta POST]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
