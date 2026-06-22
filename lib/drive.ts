// Lato server SOLO. Gestisce OAuth (token del proprietario) e le chiamate REST a Google Drive.
// Non importare questo file da componenti client.
import { OAuth2Client } from "google-auth-library";
import { folderNameForDate } from "./format";
import { defaultMeta, sanitizeMeta, type ProvaMeta } from "./band";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const META_NAME = "_prova.json";

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
  const created = (await createRes.json()) as SessionFolder;
  // Cartella nuova → crea subito il file dei metadati di default (best-effort: non blocca l'upload).
  try {
    await writeMeta(created.id, defaultMeta());
  } catch (e) {
    console.error("[ensureSessionFolder] writeMeta:", e);
  }
  return created;
}

/**
 * Apre una sessione di upload "resumable" e restituisce l'URL di sessione.
 * Il client farà il PUT dei byte direttamente su quell'URL (l'access token NON viene esposto).
 */
export async function createResumableSession(
  folderId: string,
  fileName: string,
  mimeType: string,
  origin?: string,
): Promise<string> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": mimeType || "application/octet-stream",
  };
  // Inoltrare l'Origin del browser fa sì che Google restituisca gli header CORS sul PUT
  // successivo: senza, l'upload diretto dal browser viene bloccato dalla CORS policy.
  if (origin) headers.Origin = origin;
  const res = await fetch(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`, {
    method: "POST",
    headers,
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

/* ─────────────────────────  Sezione "Prove": lista, streaming, metadati  ───────────────────────── */

export interface DriveFolder {
  id: string;
  name: string;
}
export interface AudioFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}
export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  subfolder: "video" | "foto";
}

/** Sottocartelle-prova dentro DRIVE_FOLDER_ID, dalla più recente. */
export async function listRehearsalFolders(): Promise<DriveFolder[]> {
  const token = await accessToken();
  const parent = env("DRIVE_FOLDER_ID");
  const q = `'${parent}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const url =
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=name desc` +
    `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await driveFetch(token, url);
  if (!res.ok) throw new Error(`Drive (lista cartelle) ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { files?: DriveFolder[] };
  return (j.files ?? []).filter((f) => /^\d{4} \d{2} \d{2}$/.test(f.name));
}

/** File audio dentro una cartella, in ordine cronologico (l'orario è in testa al nome). */
export async function listAudioFiles(folderId: string): Promise<AudioFile[]> {
  const token = await accessToken();
  const q = `'${folderId}' in parents and trashed = false and mimeType contains 'audio/'`;
  const url =
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size)&orderBy=name` +
    `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await driveFetch(token, url);
  if (!res.ok) throw new Error(`Drive (lista file) ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { files?: { id: string; name: string; mimeType: string; size?: string }[] };
  return (j.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size ?? 0),
  }));
}

/** Stream del contenuto di un file da Drive, inoltrando l'header Range (per <audio> con seek). */
export async function streamFile(id: string, range?: string | null): Promise<Response> {
  const token = await accessToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  return fetch(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { headers });
}

async function findFileByName(token: string, folderId: string, name: string): Promise<string | null> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`;
  const url =
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await driveFetch(token, url);
  if (!res.ok) throw new Error(`Drive (ricerca file) ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { files?: { id: string }[] };
  return j.files && j.files.length ? j.files[0].id : null;
}

/** Garantisce che esista una sottocartella (es. "video" o "foto") dentro la cartella-prova. */
export async function ensureSubfolder(parentId: string, subName: string): Promise<string> {
  const token = await accessToken();
  const q =
    `name = '${subName.replace(/'/g, "\\'")}' and '${parentId}' in parents ` +
    `and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const listRes = await driveFetch(
    token,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (!listRes.ok) throw new Error(`Drive (ricerca sottocartella) ${listRes.status}: ${await listRes.text()}`);
  const listJson = (await listRes.json()) as { files?: { id: string }[] };
  if (listJson.files?.length) return listJson.files[0].id;

  const createRes = await driveFetch(
    token,
    `${DRIVE}/files?fields=id&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: subName, mimeType: FOLDER_MIME, parents: [parentId] }),
    },
  );
  if (!createRes.ok) throw new Error(`Drive (crea sottocartella) ${createRes.status}: ${await createRes.text()}`);
  return ((await createRes.json()) as { id: string }).id;
}

/** File media (video + foto) nelle sottocartelle di una cartella-prova. */
export async function listMediaFiles(sessionFolderId: string): Promise<MediaFile[]> {
  const token = await accessToken();
  const q =
    `'${sessionFolderId}' in parents and mimeType = '${FOLDER_MIME}' ` +
    `and (name = 'video' or name = 'foto') and trashed = false`;
  const subRes = await driveFetch(
    token,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (!subRes.ok) return [];
  const subJson = (await subRes.json()) as { files?: { id: string; name: string }[] };

  const results: MediaFile[] = [];
  for (const sub of subJson.files ?? []) {
    const subfolder = sub.name as "video" | "foto";
    const mimeFilter = subfolder === "video" ? "mimeType contains 'video/'" : "mimeType contains 'image/'";
    const q2 = `'${sub.id}' in parents and trashed = false and ${mimeFilter}`;
    const filesRes = await driveFetch(
      token,
      `${DRIVE}/files?q=${encodeURIComponent(q2)}&fields=files(id,name,mimeType,size)&orderBy=name` +
        `&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    );
    if (!filesRes.ok) continue;
    const filesJson = (await filesRes.json()) as {
      files?: { id: string; name: string; mimeType: string; size?: string }[];
    };
    for (const f of filesJson.files ?? []) {
      results.push({ id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), subfolder });
    }
  }
  return results;
}

/** Legge i metadati della prova (_prova.json). Se manca, ritorna i default. */
export async function readMeta(folderId: string): Promise<ProvaMeta> {
  const token = await accessToken();
  const fileId = await findFileByName(token, folderId, META_NAME);
  if (!fileId) return defaultMeta();
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`);
  if (!res.ok) return defaultMeta();
  try {
    return sanitizeMeta(await res.json());
  } catch {
    return defaultMeta();
  }
}

/**
 * Apre una sessione di upload resumable per aggiornare il contenuto di un file esistente.
 * Opzionalmente rinomina il file. Il client fa il PUT dei byte all'URL restituito.
 */
export async function createResumableUpdateSession(
  fileId: string,
  mimeType: string,
  newName?: string,
  origin?: string,
): Promise<string> {
  const token = await accessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": mimeType,
  };
  if (origin) headers.Origin = origin;
  const meta: Record<string, string> = {};
  if (newName) meta.name = newName;
  const res = await fetch(
    `${UPLOAD}/files/${fileId}?uploadType=resumable&supportsAllDrives=true`,
    { method: "PATCH", headers, body: JSON.stringify(meta) },
  );
  if (!res.ok) throw new Error(`Drive (update session) ${res.status}: ${await res.text()}`);
  const location = res.headers.get("location");
  if (!location) throw new Error("URL di sessione mancante");
  return location;
}

/** Mette nel cestino un file Drive. */
export async function deleteFile(fileId: string): Promise<void> {
  const token = await accessToken();
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?supportsAllDrives=true`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Drive (elimina) ${res.status}: ${await res.text()}`);
  }
}

/** Rinomina un file Drive. */
export async function renameFile(fileId: string, newName: string): Promise<void> {
  const token = await accessToken();
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
  if (!res.ok) throw new Error(`Drive (rinomina) ${res.status}: ${await res.text()}`);
}

/** Crea o aggiorna _prova.json dentro la cartella. */
export async function writeMeta(folderId: string, meta: ProvaMeta): Promise<void> {
  const token = await accessToken();
  const body = JSON.stringify(meta, null, 2);
  const existing = await findFileByName(token, folderId, META_NAME);

  if (existing) {
    const res = await fetch(`${UPLOAD}/files/${existing}?uploadType=media&supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) throw new Error(`Drive (update meta) ${res.status}: ${await res.text()}`);
    return;
  }

  const boundary = `afdsa-meta-${Date.now()}`;
  const metadata = JSON.stringify({ name: META_NAME, parents: [folderId], mimeType: "application/json" });
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await fetch(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive (create meta) ${res.status}: ${await res.text()}`);
}
