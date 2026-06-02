// Sonda CORS: capisce quale risposta di Google porta Access-Control-Allow-Origin (ACAO),
// così decidiamo come fare l'upload dal browser. Colpisce Google direttamente (creds da .env.local).
import { OAuth2Client } from "google-auth-library";
import { readFileSync } from "node:fs";

const ORIGIN = process.argv[2] || "https://rec-to-share.vercel.app";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].trim();
}
const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
client.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });
const { token } = await client.getAccessToken();
const PARENT = env.DRIVE_FOLDER_ID;

async function del(id) {
  if (!id) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  });
}

// --- A) Resumable, init con/senza header Origin ---
async function resumable(withOrigin) {
  const initHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": "text/plain",
  };
  if (withOrigin) initHeaders.Origin = ORIGIN;
  const init = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
    method: "POST", headers: initHeaders,
    body: JSON.stringify({ name: `__probe_res_${withOrigin ? "O" : "N"}.txt`, parents: [PARENT] }),
  });
  const loc = init.headers.get("location");
  const initACAO = init.headers.get("access-control-allow-origin");
  // PUT come farebbe il browser (manda sempre Origin)
  const put = await fetch(loc, { method: "PUT", headers: { "Content-Type": "text/plain", Origin: ORIGIN }, body: "hello" });
  const putACAO = put.headers.get("access-control-allow-origin");
  const j = await put.json().catch(() => ({}));
  await del(j.id);
  return { initStatus: init.status, initACAO, putStatus: put.status, putACAO };
}

// --- B) Multipart, POST unico con header Origin ---
async function multipart() {
  const boundary = "afdsa" + Date.now();
  const meta = JSON.stringify({ name: "__probe_mp.txt", parents: [PARENT] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nhello\r\n--${boundary}--`;
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}`, Origin: ORIGIN },
    body,
  });
  const acao = res.headers.get("access-control-allow-origin");
  const j = await res.json().catch(() => ({}));
  await del(j.id);
  return { status: res.status, acao };
}

console.log("Origin testato:", ORIGIN, "\n");
console.log("A) resumable init CON Origin   →", JSON.stringify(await resumable(true)));
console.log("A) resumable init SENZA Origin →", JSON.stringify(await resumable(false)));
console.log("B) multipart  POST con Origin  →", JSON.stringify(await multipart()));
console.log("\nLegenda: serve putACAO/acao = l'Origin (o *) sulla risposta del trasferimento file.");
