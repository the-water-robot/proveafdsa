// Test end-to-end contro l'app in produzione: health → crea sessione → PUT reale → controlla CORS → cleanup.
// Verifica il CORS sulla RISPOSTA del PUT (ciò che il browser richiede davvero), non sul preflight.
// Uso:  node scripts/prod-test.mjs [https://rec-to-share.vercel.app]
import { OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "https://rec-to-share.vercel.app";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const log = (...a) => console.log(...a);

// 1) health
const health = await (await fetch(`${BASE}/api/health`)).json();
log("1) /api/health      →", JSON.stringify(health));

// 2) richiedi una sessione di upload (passando l'origin, come fa il browser)
const d = new Date();
const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const upRes = await fetch(`${BASE}/api/upload-url`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ rehearsalDate: iso, fileName: "__deploy_test.txt", mimeType: "text/plain", label: "deploy-test", origin: BASE }),
});
const up = await upRes.json();
log("2) /api/upload-url  →", upRes.status, JSON.stringify({ folder: up.folderName, hasSession: !!up.sessionUrl, err: up.error }));
if (!up.sessionUrl) process.exit(1);

// 3) PUT reale con header Origin (come il browser); leggo l'ACAO SULLA RISPOSTA del PUT
const putRes = await fetch(up.sessionUrl, {
  method: "PUT",
  headers: { "Content-Type": "text/plain", Origin: BASE },
  body: `deploy test ${new Date().toISOString()}`,
});
const putACAO = putRes.headers.get("access-control-allow-origin");
const put = await putRes.json().catch(() => ({}));
log("3) PUT (upload)     →", putRes.status, "| fileId:", put.id || "(nessuno)", "| CORS ACAO:", putACAO || "(nessuno)");

// 4) cleanup: cancella il file di test
const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
const { token } = await client.getAccessToken();
if (put.id) {
  const del = await fetch(`https://www.googleapis.com/drive/v3/files/${put.id}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  log("4) cleanup file     →", del.status === 204 ? "cancellato ✓" : `HTTP ${del.status}`);
}

const ok = health.ok && up.sessionUrl && putRes.status >= 200 && putRes.status < 300;
const corsOk = !!putACAO;
log(`\n${ok ? "✅" : "❌"} Pipeline upload: ${ok ? "FUNZIONA" : "PROBLEMA"} | CORS browser: ${corsOk ? "OK ✓" : "BLOCCATO ✗"}`);
