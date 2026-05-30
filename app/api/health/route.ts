import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Controllo rapido che le variabili d'ambiente siano configurate.
// Apri /api/health dopo il deploy per verificare il setup (NON espone segreti).
export async function GET() {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "DRIVE_FOLDER_ID",
  ];
  const missing = required.filter((k) => !process.env[k]);

  return NextResponse.json({
    ok: missing.length === 0,
    missing,
    pinProtected: Boolean(process.env.UPLOAD_PIN?.trim()),
    driveFolderId: process.env.DRIVE_FOLDER_ID ?? null,
  });
}
