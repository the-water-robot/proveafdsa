// Script una-tantum: genera il GOOGLE_REFRESH_TOKEN per l'account proprietario della cartella Drive.
//
// Prerequisiti:
//   1. Su https://console.cloud.google.com  →  abilita "Google Drive API".
//   2. Crea credenziali  →  "OAuth client ID"  →  tipo "Desktop app".
//   3. Schermata consenso in modalità "Testing": aggiungi il tuo account come "test user".
//   4. Copia .env.local.example in .env.local e incolla GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
//
// Poi:  npm run get-token   →  accedi col tuo account  →  copia il token stampato.

import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { OAuth2Client } from "google-auth-library";

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = ["https://www.googleapis.com/auth/drive"];

function loadEnvLocal() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

const env = { ...loadEnvLocal(), ...process.env };
const clientId = env.GOOGLE_CLIENT_ID;
const clientSecret = env.GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error("\n❌ Mancano GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.");
  console.error("   Copia .env.local.example in .env.local, incollali e rilancia `npm run get-token`.\n");
  process.exit(1);
}

const client = new OAuth2Client(clientId, clientSecret, REDIRECT);
const authUrl = client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPE,
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT);
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Nessun parametro 'code' nella richiesta.");
      return;
    }
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h1>Fatto ✅</h1><p>Torna al terminale: il refresh token è stato stampato lì. Puoi chiudere questa pagina.</p>",
    );
    server.close();

    if (tokens.refresh_token) {
      console.log("\n✅ Token ottenuto! Incollalo in .env.local e nelle Environment Variables di Vercel:\n");
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } else {
      console.error(
        "\n⚠️  Nessun refresh_token restituito.\n" +
          "   Revoca l'accesso su https://myaccount.google.com/permissions e riprova\n" +
          "   (il refresh token viene dato solo al primo consenso).\n",
      );
    }
    process.exit(0);
  } catch (e) {
    res.writeHead(500).end("Errore: " + e.message);
    console.error("\n❌", e.message, "\n");
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("\n────────────────────────────────────────────────────────");
  console.log(" 1) Si aprirà il browser.");
  console.log(" 2) Accedi con l'account Google PROPRIETARIO della cartella Drive (quello 'u/1').");
  console.log(" 3) Autorizza l'accesso a Google Drive.");
  console.log("────────────────────────────────────────────────────────");
  console.log("\nSe il browser non si apre da solo, vai a:\n\n" + authUrl + "\n");
  openBrowser(authUrl);
});

function openBrowser(u) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [u], {
      stdio: "ignore",
      detached: true,
      shell: process.platform === "win32",
    }).unref();
  } catch {
    /* l'utente userà l'URL stampato */
  }
}
