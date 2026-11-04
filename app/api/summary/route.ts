import { NextRequest, NextResponse } from "next/server";
import { summarizeFolders } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Riepilogo (conteggi audio/foto/video + info) per un gruppo di prove: GET /api/summary?ids=a,b,c
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  if (!ids.length) return NextResponse.json({ error: "Parametro 'ids' mancante." }, { status: 400 });
  try {
    return NextResponse.json({ summaries: await summarizeFolders(ids) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[summary]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
