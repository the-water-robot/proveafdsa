import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, streamFile } from "@/lib/drive";
import { mimeFor } from "@/lib/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Proxy-stream di un file di Drive verso il browser (per <audio>), inoltrando l'header Range.
// Il token resta sul server: il client riceve solo i byte.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Parametro 'id' mancante." }, { status: 400 });
  }
  const download = req.nextUrl.searchParams.get("download");

  try {
    const info = await assertInRoot(id);
    const upstream = await streamFile(id, req.headers.get("range"));
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Drive ${upstream.status}` },
        { status: upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502 },
      );
    }

    const headers = new Headers();
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
    // Il tipo salvato su Drive può essere sbagliato (es. .m4a come "audio/mpeg"): Safari/iPhone
    // in quel caso rifiuta di riprodurre. Correggilo dall'estensione del file.
    headers.set("content-type", mimeFor(info.name, upstream.headers.get("content-type") || info.mimeType));
    // L'URL include ?v=<modifiedTime> lato client: dopo un taglio/sovrascrittura cambia → niente cache stantia.
    headers.set("cache-control", "private, max-age=3600");
    if (download) {
      const ascii = info.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
      headers.set(
        "content-disposition",
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(info.name)}`,
      );
    }

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[stream]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
