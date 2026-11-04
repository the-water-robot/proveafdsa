import { NextRequest, NextResponse } from "next/server";
import { assertInRoot, errorStatus, pinOk, setRating } from "@/lib/drive";
import { isMember } from "@/lib/band";
import { kindOf } from "@/lib/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Voto di un membro su una traccia: POST { id, who, stars (0 = togli), pin? }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown; who?: unknown; stars?: unknown; pin?: unknown };
    if (!pinOk(body.pin)) return NextResponse.json({ error: "Codice di accesso errato." }, { status: 401 });
    const id = typeof body.id === "string" ? body.id : "";
    const who = typeof body.who === "string" ? body.who.toLowerCase() : "";
    const stars = Number(body.stars);
    if (!id) return NextResponse.json({ error: "id mancante" }, { status: 400 });
    if (!isMember(who)) return NextResponse.json({ error: "Dimmi chi sei per votare." }, { status: 400 });
    if (!Number.isInteger(stars) || stars < 0 || stars > 5) {
      return NextResponse.json({ error: "Voto non valido." }, { status: 400 });
    }
    const info = await assertInRoot(id);
    if (kindOf(info.name, info.mimeType) !== "audio") {
      return NextResponse.json({ error: "Si possono votare solo le registrazioni audio." }, { status: 400 });
    }
    return NextResponse.json({ ratings: await setRating(id, who, stars) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore";
    console.error("[rating]", message);
    return NextResponse.json({ error: message }, { status: errorStatus(err) });
  }
}
