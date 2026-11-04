import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, listMediaFiles } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const folder = req.nextUrl.searchParams.get("folder");
    if (!folder) return NextResponse.json({ error: "Parametro 'folder' mancante." }, { status: 400 });
    await assertInRoot(folder);
    const files = await listMediaFiles(folder);
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[media]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
