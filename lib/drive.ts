// Lato server SOLO. Gestisce OAuth (token del proprietario) e le chiamate REST a Google Drive.
// Non importare questo file da componenti client.
import { OAuth2Client } from "google-auth-library";
import { folderNameForDate } from "./format";
import { defaultMeta, sanitizeMeta, type ProvaMeta } from "./band";
import { labelOf } from "./recording";
import { kindOf, mimeFor } from "./mime";
import { NOTES_FILE, sanitizeNote, type MusicNote } from "./notes";
import { BEST_MIN, average, ratingKey, ratingsFromProps, type Ratings } from "./ratings";

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

/* ─────────────────────────  Controllo accessi  ───────────────────────── */

/** Errore "di accesso": l'id non appartiene all'albero di DRIVE_FOLDER_ID (o non esiste). */
export class DriveAccessError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export interface FileInfo {
  id: string;
  name: string;
  mimeType: string;
}

// Cache per istanza (warm lambda): id già verificati dentro la cartella della band.
const insideRoot = new Map<string, FileInfo>();

/**
 * Verifica che `id` sia un file/cartella DENTRO DRIVE_FOLDER_ID (fino a 4 livelli: prova/sub/file).
 * Il token ha scope `drive` pieno: senza questo controllo chiunque potrebbe leggere/eliminare
 * qualsiasi file del proprietario conoscendone l'id.
 */
export async function assertInRoot(id: string): Promise<FileInfo> {
  if (!/^[\w-]{10,}$/.test(id)) throw new DriveAccessError("Id non valido.", 400);
  const cached = insideRoot.get(id);
  if (cached) return cached;

  const root = env("DRIVE_FOLDER_ID");
  if (id === root) throw new DriveAccessError("Operazione non consentita.");
  const token = await accessToken();

  const chain: FileInfo[] = [];
  let cur = id;
  for (let depth = 0; depth < 4; depth++) {
    const res = await driveFetch(
      token,
      `${DRIVE}/files/${encodeURIComponent(cur)}?fields=id,name,mimeType,parents&supportsAllDrives=true`,
    );
    if (res.status === 404) throw new DriveAccessError("File non trovato.", 404);
    if (!res.ok) throw new Error(`Drive (metadati) ${res.status}: ${await res.text()}`);
    const f = (await res.json()) as FileInfo & { parents?: string[] };
    chain.push({ id: f.id, name: f.name, mimeType: f.mimeType });
    const parents = f.parents ?? [];
    const parentOk = parents.find((p) => p === root || insideRoot.has(p));
    if (parentOk) {
      for (const c of chain) insideRoot.set(c.id, c);
      return chain[0];
    }
    if (!parents.length) break;
    cur = parents[0];
  }
  throw new DriveAccessError("Operazione non consentita su questo file.");
}

/** Controllo del PIN opzionale (UPLOAD_PIN). */
export function pinOk(provided: unknown): boolean {
  const pin = process.env.UPLOAD_PIN?.trim();
  return !pin || provided === pin;
}

/** Risposta JSON d'errore coerente per le route. */
export function errorStatus(err: unknown): number {
  return err instanceof DriveAccessError ? err.status : 500;
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
  modifiedTime?: string;
  ratings?: Ratings;
  folder?: { id: string; name: string }; // solo nelle liste multi-prova ("Il meglio")
}
export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  subfolder: "video" | "foto";
  hasThumbnail?: boolean;
}

let foldersMemo: { at: number; ids: Set<string> } | null = null;

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
  const folders = (j.files ?? []).filter((f) => /^\d{4} \d{2} \d{2}$/.test(f.name));
  for (const f of folders) insideRoot.set(f.id, { id: f.id, name: f.name, mimeType: FOLDER_MIME });
  foldersMemo = { at: Date.now(), ids: new Set(folders.map((f) => f.id)) };
  return folders;
}

interface RawFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  hasThumbnail?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
}

/** File (non cartelle) dentro una o più cartelle, ordinati per nome (= orario in testa). */
async function listChildren(token: string, parentIds: string[]): Promise<RawFile[]> {
  if (!parentIds.length) return [];
  const q =
    `(${parentIds.map((id) => `'${id}' in parents`).join(" or ")}) ` +
    `and mimeType != '${FOLDER_MIME}' and trashed = false`;
  const out: RawFile[] = [];
  let pageToken = "";
  do {
    const res = await driveFetch(
      token,
      `${DRIVE}/files?q=${encodeURIComponent(q)}` +
        `&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,hasThumbnail,parents,appProperties)` +
        `&orderBy=name&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
        (pageToken ? `&pageToken=${pageToken}` : ""),
    );
    if (!res.ok) throw new Error(`Drive (lista file) ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { files?: RawFile[]; nextPageToken?: string };
    out.push(...(j.files ?? []));
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

function trust(parentId: string, files: RawFile[]) {
  // chiamata solo dopo assertInRoot(parentId) → i figli sono dentro la cartella della band
  if (!insideRoot.has(parentId)) return;
  for (const f of files) insideRoot.set(f.id, { id: f.id, name: f.name, mimeType: f.mimeType });
}

/**
 * File audio di una cartella-prova, in ordine cronologico (l'orario è in testa al nome).
 * Il tipo si decide anche dall'estensione: su Drive ci sono .m4a salvati come "audio/mpeg" ecc.
 */
export async function listAudioFiles(folderId: string): Promise<AudioFile[]> {
  const token = await accessToken();
  const raw = (await listChildren(token, [folderId])).filter((f) => kindOf(f.name, f.mimeType) === "audio");
  trust(folderId, raw);
  return raw.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: mimeFor(f.name, f.mimeType),
    size: Number(f.size ?? 0),
    modifiedTime: f.modifiedTime,
    ratings: ratingsFromProps(f.appProperties),
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

/**
 * Foto e video di una cartella-prova: sia nelle sottocartelle "video"/"foto" (dove li mette l'app)
 * sia sparsi nella cartella (caricati a mano da Drive, es. i .mov dell'iPhone).
 */
export async function listMediaFiles(sessionFolderId: string): Promise<MediaFile[]> {
  const token = await accessToken();
  const q = `'${sessionFolderId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const subRes = await driveFetch(
    token,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  const subs = subRes.ok ? (((await subRes.json()) as { files?: { id: string }[] }).files ?? []) : [];
  if (insideRoot.has(sessionFolderId)) {
    for (const sub of subs) insideRoot.set(sub.id, { id: sub.id, name: "", mimeType: FOLDER_MIME });
  }
  const raw = (await listChildren(token, [sessionFolderId, ...subs.map((x) => x.id)])).filter((f) => {
    const k = kindOf(f.name, f.mimeType);
    return k === "video" || k === "image";
  });
  trust(sessionFolderId, raw);
  return raw.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: mimeFor(f.name, f.mimeType),
    size: Number(f.size ?? 0),
    subfolder: kindOf(f.name, f.mimeType) === "video" ? "video" : "foto",
    hasThumbnail: Boolean(f.hasThumbnail),
  }));
}

/** Miniatura generata da Drive (funziona anche per HEIC e video). `size` = lato lungo in px. */
export async function fetchThumbnail(id: string, size: number): Promise<Response | null> {
  const token = await accessToken();
  const meta = await driveFetch(token, `${DRIVE}/files/${id}?fields=thumbnailLink&supportsAllDrives=true`);
  if (!meta.ok) return null;
  const { thumbnailLink } = (await meta.json()) as { thumbnailLink?: string };
  if (!thumbnailLink) return null;
  const url = thumbnailLink.replace(/=s\d+$/, "") + `=s${Math.max(64, Math.min(2000, size))}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.ok ? res : null;
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
  const cached = insideRoot.get(fileId);
  if (cached && newName) insideRoot.set(fileId, { ...cached, name: newName, mimeType });
  const location = res.headers.get("location");
  if (!location) throw new Error("URL di sessione mancante");
  return location;
}

/** Mette nel cestino un file Drive. */
export async function deleteFile(fileId: string): Promise<void> {
  const token = await accessToken();
  // PATCH trashed=true (recuperabile dal cestino di Drive per 30 giorni), non DELETE definitivo.
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok) {
    throw new Error(`Drive (elimina) ${res.status}: ${await res.text()}`);
  }
  insideRoot.delete(fileId);
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
  const cached = insideRoot.get(fileId);
  if (cached) insideRoot.set(fileId, { ...cached, name: newName });
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

/* ─────────────────────────  Repertorio: titoli usati nelle prove recenti  ───────────────────────── */

export interface SongSuggestion {
  title: string;
  count: number; // quante registrazioni lo usano
  last: string; // data (nome cartella) dell'ultima volta
}

let songsCache: { at: number; songs: SongSuggestion[] } | null = null;

/** Titoli dei pezzi dalle ultime `maxFolders` prove, ordinati per frequenza e recenza. Cache 10 min. */
export async function listRecentSongs(maxFolders = 12): Promise<SongSuggestion[]> {
  if (songsCache && Date.now() - songsCache.at < 10 * 60 * 1000) return songsCache.songs;
  const folders = (await listRehearsalFolders()).slice(0, maxFolders);
  if (!folders.length) return [];
  const nameById = new Map(folders.map((f) => [f.id, f.name]));
  const token = await accessToken();
  const q =
    `(${folders.map((f) => `'${f.id}' in parents`).join(" or ")}) ` +
    `and mimeType contains 'audio/' and trashed = false`;
  const res = await driveFetch(
    token,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(name,parents)&pageSize=1000` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (!res.ok) throw new Error(`Drive (repertorio) ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { files?: { name: string; parents?: string[] }[] };

  const byKey = new Map<string, SongSuggestion>();
  for (const f of j.files ?? []) {
    const title = labelOf(f.name).replace(/\s*\(?\s*taglio\s*\)?$/i, "").replace(/\s+—\s+taglio$/i, "").trim();
    // scarta etichette troppo corte/strane ("d", "d — d") o troppo lunghe
    if (!title || title.length > 40 || title.replace(/[^\p{L}]/gu, "").length < 3) continue;
    if (new Set(title.toLowerCase().split(/\s*—\s*/)).size < title.split(/\s*—\s*/).length) continue;
    const key = title.toLowerCase();
    const day = nameById.get(f.parents?.[0] ?? "") ?? "";
    const cur = byKey.get(key);
    if (cur) {
      cur.count++;
      if (day > cur.last) cur.last = day;
    } else {
      byKey.set(key, { title, count: 1, last: day });
    }
  }
  const songs = Array.from(byKey.values()).sort(
    (a, b) => b.last.localeCompare(a.last) || b.count - a.count || a.title.localeCompare(b.title),
  );
  songsCache = { at: Date.now(), songs };
  return songs;
}

/** Da chiamare dopo un upload/rinomina: il repertorio va ricalcolato. */
export function invalidateSongs() {
  songsCache = null;
}

/* ─────────────────  Riepilogo per la lista prove (conteggi + info) a gruppi  ───────────────── */

export interface FolderSummary {
  id: string;
  best: number; // tracce con media ≥ BEST_MIN
  audio: number;
  photos: number;
  videos: number;
  meta: ProvaMeta;
  notes: number;
}

/** Riepilogo di più cartelle-prova con poche chiamate: sottocartelle, tutti i file, i _prova.json. */
export async function summarizeFolders(ids: string[]): Promise<FolderSummary[]> {
  // solo cartelle-prova vere (evita di usare l'endpoint per sbirciare altro del Drive)
  if (!foldersMemo || Date.now() - foldersMemo.at > 60_000) {
    foldersMemo = { at: Date.now(), ids: new Set((await listRehearsalFolders()).map((f) => f.id)) };
  }
  const valid = ids.filter((id) => foldersMemo!.ids.has(id)).slice(0, 12);
  if (!valid.length) return [];
  const token = await accessToken();

  const sum = new Map<string, FolderSummary>(
    valid.map((id) => [id, { id, best: 0, audio: 0, photos: 0, videos: 0, notes: 0, meta: defaultMeta() }]),
  );
  const count = (s: FolderSummary | undefined, f: RawFile) => {
    if (!s || f.name === META_NAME) return;
    if (f.name === NOTES_FILE) {
      s.notes = Number(f.appProperties?.count) || 0; // contatore salvato sul file: niente download
      return;
    }
    const k = kindOf(f.name, f.mimeType);
    if (k === "audio") {
      s.audio++;
      if ((average(ratingsFromProps(f.appProperties)) ?? 0) >= BEST_MIN) s.best++;
    } else if (k === "image") s.photos++;
    else if (k === "video") s.videos++;
  };

  // Giro 1 (in parallelo): sottocartelle (video/foto) + file nelle cartelle-prova
  const subQ =
    `(${valid.map((id) => `'${id}' in parents`).join(" or ")}) ` +
    `and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const [subs, rootFiles] = await Promise.all([
    driveFetch(
      token,
      `${DRIVE}/files?q=${encodeURIComponent(subQ)}&fields=files(id,parents)&pageSize=1000` +
        `&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    ).then(async (r) => (r.ok ? (((await r.json()) as { files?: { id: string; parents?: string[] }[] }).files ?? []) : [])),
    listChildren(token, valid),
  ]);
  for (const f of rootFiles) count(sum.get(f.parents?.[0] ?? ""), f);
  const owner = new Map<string, string>();
  for (const sub of subs) if (sub.parents?.[0]) owner.set(sub.id, sub.parents[0]);

  // Giro 2 (in parallelo): file nelle sottocartelle + lettura dei _prova.json
  await Promise.all([
    listChildren(token, [...owner.keys()]).then((files) => {
      for (const f of files) count(sum.get(owner.get(f.parents?.[0] ?? "") ?? ""), f);
    }),
    ...rootFiles
      .filter((f) => f.name === META_NAME)
      .map(async (f) => {
        const s = sum.get(f.parents?.[0] ?? "");
        const r = await driveFetch(token, `${DRIVE}/files/${f.id}?alt=media&supportsAllDrives=true`);
        if (s && r.ok) s.meta = sanitizeMeta(await r.json().catch(() => ({})));
      }),
  ]);
  return valid.map((id) => sum.get(id)!);
}

/* ─────────────────  Voti a stelle  ───────────────── */

/** Imposta (1..5) o toglie (0) il voto di un membro su un file. Ritorna tutti i voti aggiornati. */
export async function setRating(fileId: string, who: string, stars: number): Promise<Ratings> {
  const token = await accessToken();
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?fields=appProperties&supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // null cancella la proprietà; gli altri voti non vengono toccati
    body: JSON.stringify({ appProperties: { [ratingKey(who)]: stars ? String(stars) : null } }),
  });
  if (!res.ok) throw new Error(`Drive (voto) ${res.status}: ${await res.text()}`);
  bestCache = null;
  return ratingsFromProps(((await res.json()) as { appProperties?: Record<string, string> }).appProperties);
}

let bestCache: { at: number; tracks: AudioFile[] } | null = null;

/** Le tracce migliori (media ≥ BEST_MIN) di tutte le prove, dalla media più alta. Cache 1 min. */
export async function listBestTracks(): Promise<AudioFile[]> {
  if (bestCache && Date.now() - bestCache.at < 60_000) return bestCache.tracks;
  const folders = await listRehearsalFolders();
  const nameById = new Map(folders.map((f) => [f.id, f.name]));
  const token = await accessToken();
  const out: AudioFile[] = [];
  // Drive non sa filtrare "qualsiasi voto": si leggono i file audio a gruppi di cartelle e si filtra qui
  for (let i = 0; i < folders.length; i += 25) {
    const ids = folders.slice(i, i + 25).map((f) => f.id);
    const files = await listChildren(token, ids);
    for (const f of files) {
      if (kindOf(f.name, f.mimeType) !== "audio") continue;
      const ratings = ratingsFromProps(f.appProperties);
      if ((average(ratings) ?? 0) < BEST_MIN) continue;
      const fid = f.parents?.[0] ?? "";
      insideRoot.set(f.id, { id: f.id, name: f.name, mimeType: f.mimeType });
      out.push({
        id: f.id,
        name: f.name,
        mimeType: mimeFor(f.name, f.mimeType),
        size: Number(f.size ?? 0),
        modifiedTime: f.modifiedTime,
        ratings,
        folder: { id: fid, name: nameById.get(fid) ?? "" },
      });
    }
  }
  out.sort(
    (a, b) =>
      (average(b.ratings) ?? 0) - (average(a.ratings) ?? 0) ||
      Object.keys(b.ratings ?? {}).length - Object.keys(a.ratings ?? {}).length ||
      (b.folder?.name ?? "").localeCompare(a.folder?.name ?? "") ||
      a.name.localeCompare(b.name),
  );
  bestCache = { at: Date.now(), tracks: out };
  return out;
}

/* ─────────────────  Appunti musicali (_appunti.json)  ───────────────── */

async function readNotesWith(token: string, folderId: string): Promise<{ fileId: string | null; notes: MusicNote[] }> {
  const fileId = await findFileByName(token, folderId, NOTES_FILE);
  if (!fileId) return { fileId: null, notes: [] };
  const res = await driveFetch(token, `${DRIVE}/files/${fileId}?alt=media&supportsAllDrives=true`);
  if (!res.ok) throw new Error(`Drive (leggi appunti) ${res.status}: ${await res.text()}`);
  const j = (await res.json().catch(() => ({}))) as { notes?: unknown[] };
  const notes = (j.notes ?? []).map(sanitizeNote).filter((n): n is MusicNote => !!n);
  return { fileId, notes };
}

/** Appunti della prova, dal più recente. */
export async function readNotes(folderId: string): Promise<MusicNote[]> {
  const { notes } = await readNotesWith(await accessToken(), folderId);
  return notes.sort((a, b) => b.created - a.created);
}

/**
 * Modifica gli appunti leggendo l'ultima versione da Drive subito prima di scrivere:
 * due persone che aggiungono appunti diversi insieme non si cancellano a vicenda.
 */
export async function updateNotes(folderId: string, fn: (notes: MusicNote[]) => MusicNote[]): Promise<MusicNote[]> {
  const token = await accessToken();
  const { fileId, notes } = await readNotesWith(token, folderId);
  const next = fn(notes).sort((a, b) => b.created - a.created);
  const body = JSON.stringify({ version: 1, notes: next }, null, 1);
  const metadata: Record<string, unknown> = { appProperties: { count: String(next.length) } };
  if (!fileId) Object.assign(metadata, { name: NOTES_FILE, parents: [folderId], mimeType: "application/json" });
  const boundary = `afdsa-notes-${Date.now()}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const url = fileId
    ? `${UPLOAD}/files/${fileId}?uploadType=multipart&supportsAllDrives=true`
    : `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`;
  const res = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive (salva appunti) ${res.status}: ${await res.text()}`);
  return next;
}
