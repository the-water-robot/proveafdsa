import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, listAudioFiles } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const folder = req.nextUrl.searchParams.get("folder");
  if (!folder) {
    return NextResponse.json({ error: "Parametro 'folder' mancante." }, { status: 400 });
  }
  try {
    await assertInRoot(folder);
    const files = await listAudioFiles(folder);
    return NextResponse.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[files]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
