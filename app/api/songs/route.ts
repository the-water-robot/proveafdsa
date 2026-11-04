import { NextResponse } from "next/server";
import { listRecentSongs } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Suggerimenti di etichetta: i pezzi suonati nelle prove recenti.
export async function GET() {
  try {
    const songs = await listRecentSongs();
    return NextResponse.json({ songs: songs.slice(0, 30) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[songs]", message);
    return NextResponse.json({ error: message, songs: [] }, { status: 500 });
  }
}
