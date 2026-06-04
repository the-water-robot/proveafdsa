// Attende che il deploy con il fix CORS sia live e lo verifica:
// chiama l'app in produzione, fa un PUT con Origin e controlla che la risposta porti l'header CORS.
// Esegue il polling perché l'auto-deploy da GitHub impiega ~1-2 min.
// Uso:  node scripts/verify-cors.mjs [https://proveafdsa.vercel.app]
import { OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "https://proveafdsa.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
const { token } = await client.getAccessToken();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const up = await (await fetch(`${BASE}/api/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rehearsalDate: iso, fileName: "__verify_cors.txt", mimeType: "text/plain", origin: BASE }),
  })).json();
  if (!up.sessionUrl) return { acao: null, status: 0, err: up.error };
  const put = await fetch(up.sessionUrl, { method: "PUT", headers: { "Content-Type": "text/plain", Origin: BASE }, body: "verify" });
  const acao = put.headers.get("access-control-allow-origin");
  const j = await put.json().catch(() => ({}));
  if (j.id) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${j.id}?supportsAllDrives=true`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
  }
  return { acao, status: put.status };
}

const MAX = 24;
for (let i = 1; i <= MAX; i++) {
  const r = await attempt();
  console.log(`tentativo ${i}/${MAX}: putStatus=${r.status} ACAO=${r.acao || "null"}${r.err ? " err=" + r.err : ""}`);
  if (r.acao) {
    console.log("\n✅ FIX LIVE: il PUT dal browser ora riceve Access-Control-Allow-Origin. Upload sbloccato.");
    process.exit(0);
  }
  if (i < MAX) await sleep(8000);
}
console.log("\n❌ Ancora bloccato dopo l'attesa: deploy lento, oppure il runtime Vercel rimuove l'header Origin (passare al piano B: token a breve scadenza lato browser).");
process.exit(1);
