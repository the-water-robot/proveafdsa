import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fallback del Web Share Target.
// Quando la PWA è installata, il service worker (public/sw.js) intercetta il POST su /share,
// mette da parte il file e reindirizza alla home con ?shared=1. Questo handler serve solo
// come rete di sicurezza se il SW non è ancora attivo: rimanda alla home.
export async function POST() {
  return NextResponse.redirect(new URL("/?shared=miss", baseUrl()), 303);
}

export async function GET() {
  return NextResponse.redirect(new URL("/", baseUrl()), 303);
}

function baseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv;
  const vercel = process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}
