// Lato server SOLO. Gestisce OAuth (token del proprietario) e le chiamate REST a Google Drive.
// Non importare questo file da componenti client.
import { OAuth2Client } from "google-auth-library";
import { folderNameForDate } from "./format";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

let cachedClient: OAuth2Client | null = null;

function oauthClient(): OAuth2Client {
  if (cachedClient) return cachedClient;
  const client = new OAuth2Client(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"));
  client.setCredentials({ refresh_token: env("GOOGLE_REFRESH_TOKEN") });
  cachedClient = client;
  return client;
}

/** Access token fresco (la libreria fa il refresh in automatico e lo mette in cache). */
async function accessToken(): Promise<string> {
  const { token } = await oauthClient().getAccessToken();
  if (!token) throw new Error("Impossibile ottenere l'access token Google.");
  return token;
}

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
}

export interface SessionFolder {
  id: string;
  name: string;
  webViewLink: string;
}

/**
 * Garantisce che esista la sottocartella della prova (nome = data, es. "2026 05 30")
 * dentro DRIVE_FOLDER_ID. La crea se manca, altrimenti riusa quella esistente.
 */
export async function ensureSessionFolder(dateIso?: string): Promise<SessionFolder> {
  const token = await accessToken();
  const parent = env("DRIVE_FOLDER_ID");
  const name = folderNameForDate(dateIso);

  const q = `name = '${name.replace(/'/g, "\\'")}' and '${parent}' in parents ` +
    `and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const listUrl =
    `${DRIVE}/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name,webViewLink)&pageSize=1` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const listRes = await driveFetch(token, listUrl);
  if (!listRes.ok) {
    throw new Error(`Drive (ricerca cartella) ${listRes.status}: ${await listRes.text()}`);
  }
  const listJson = (await listRes.json()) as { files?: SessionFolder[] };
  if (listJson.files && listJson.files.length > 0) {
    return listJson.files[0];
  }

  const createRes = await driveFetch(
    token,
    `${DRIVE}/files?fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
    },
  );
  if (!createRes.ok) {
    throw new Error(`Drive (creazione cartella) ${createRes.status}: ${await createRes.text()}`);
  }
  return (await createRes.json()) as SessionFolder;
}

/**
 * Apre una sessione di upload "resumable" e restituisce l'URL di sessione.
 * Il client farà il PUT dei byte direttamente su quell'URL (l'access token NON viene esposto).
 */
export async function createResumableSession(
  folderId: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const token = await accessToken();
  const res = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType || "application/octet-stream",
    },
    body: JSON.stringify({ name: fileName, parents: [folderId] }),
  });
  if (!res.ok) {
    throw new Error(`Drive (init resumable) ${res.status}: ${await res.text()}`);
  }
  const location = res.headers.get("location");
  if (!location) {
    throw new Error("Google non ha restituito l'URL di sessione (header Location mancante).");
  }
  return location;
}
