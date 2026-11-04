import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, fetchThumbnail } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Miniatura generata da Drive: rende visibili ovunque le foto HEIC dell'iPhone e fa da copertina ai video.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Parametro 'id' mancante." }, { status: 400 });
  const size = Number(req.nextUrl.searchParams.get("s")) || 400;
  try {
    await assertInRoot(id);
    const thumb = await fetchThumbnail(id, size);
    if (!thumb) return NextResponse.json({ error: "Miniatura non disponibile." }, { status: 404 });
    return new Response(thumb.body, {
      headers: {
        "content-type": thumb.headers.get("content-type") || "image/jpeg",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
