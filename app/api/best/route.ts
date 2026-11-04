import { NextResponse } from "next/server";
import { listBestTracks } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Il meglio": tracce con media voti alta di tutte le prove
export async function GET() {
  try {
    return NextResponse.json({ tracks: await listBestTracks() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[best]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
