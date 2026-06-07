import { NextRequest, NextResponse } from "next/server";
import { ensureSessionFolder, ensureSubfolder, createResumableSession } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Protezione opzionale: se UPLOAD_PIN è valorizzato, va fornito il codice corretto.
    const pin = process.env.UPLOAD_PIN?.trim();
    if (pin && body?.pin !== pin) {
      return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
    }

    const { rehearsalDate, fileName, mimeType, subfolder } = body ?? {};
    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json({ error: "fileName mancante." }, { status: 400 });
    }

    // Origine del browser: necessaria perché Google abiliti il CORS sul PUT diretto.
    const origin =
      (typeof body?.origin === "string" && body.origin) || req.headers.get("origin") || undefined;

    const folder = await ensureSessionFolder(rehearsalDate);
    let targetFolderId = folder.id;
    if (typeof subfolder === "string" && subfolder) {
      targetFolderId = await ensureSubfolder(folder.id, subfolder);
    }
    const sessionUrl = await createResumableSession(
      targetFolderId,
      fileName,
      typeof mimeType === "string" ? mimeType : "application/octet-stream",
      origin,
    );

    return NextResponse.json({
      sessionUrl,
      folderId: folder.id,
      folderName: folder.name,
      folderWebViewLink: folder.webViewLink,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore interno";
    console.error("[upload-url]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
