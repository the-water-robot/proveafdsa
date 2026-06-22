import { NextRequest, NextResponse } from "next/server";
import { createResumableUpdateSession } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Crea una sessione di upload resumable per sovrascrivere il contenuto di un file Drive esistente.
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
  try {
    const body = await req.json() as { mimeType?: string; newName?: string; origin?: string };
    const origin = body.origin || req.headers.get("origin") || undefined;
    const sessionUrl = await createResumableUpdateSession(
      id,
      body.mimeType || "audio/wav",
      body.newName,
      origin,
    );
    return NextResponse.json({ sessionUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Errore" }, { status: 500 });
  }
}
