// Helper lato CLIENT per la sezione "Prove" (lista cartelle, file audio, metadati, streaming).
// Tutte le chiamate passano da un fetch con retry: i blip transitori (cold-start della funzione,
// 5xx momentanei) vengono ritentati e non disturbano l'utente.
import type { ProvaMeta } from "./band";
import type { Ratings } from "./ratings";

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

async function fetchRetry(input: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(input, init);
      lastRes = res;
      // ritenta solo i 5xx (gli errori 4xx, es. PIN errato, sono definitivi)
      if (res.ok || res.status < 500) return res;
    } catch {
      /* errore di rete: ritenta */
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  if (lastRes) return lastRes;
  throw new Error("Rete non disponibile, riprova.");
}

async function jsonOrThrow(res: Response) {
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* corpo non JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchFolders(): Promise<DriveFolder[]> {
  return (await jsonOrThrow(await fetchRetry("/api/folders"))).folders;
}

export async function fetchFiles(folder: string): Promise<AudioFile[]> {
  return (await jsonOrThrow(await fetchRetry(`/api/files?folder=${encodeURIComponent(folder)}`))).files;
}

export async function fetchMeta(folder: string): Promise<ProvaMeta> {
  return (await jsonOrThrow(await fetchRetry(`/api/meta?folder=${encodeURIComponent(folder)}`))).meta;
}

export async function saveMeta(folder: string, meta: ProvaMeta, pin?: string): Promise<ProvaMeta> {
  const res = await fetchRetry("/api/meta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder, meta, pin }),
  });
  return (await jsonOrThrow(res)).meta;
}

export interface FolderSummary {
  id: string;
  best: number;
  audio: number;
  photos: number;
  videos: number;
  meta: ProvaMeta;
}

export async function fetchSummaries(ids: string[]): Promise<FolderSummary[]> {
  return (await jsonOrThrow(await fetchRetry(`/api/summary?ids=${ids.map(encodeURIComponent).join(",")}`))).summaries;
}

/** Vota (1..5) o togli il voto (0). Ritorna i voti aggiornati di tutti. */
export async function rateTrack(id: string, who: string, stars: number): Promise<Ratings> {
  const res = await fetchRetry("/api/rating", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, who, stars, pin: storedPin() }),
  });
  return (await jsonOrThrow(res)).ratings;
}

export async function fetchBest(): Promise<AudioFile[]> {
  return (await jsonOrThrow(await fetchRetry("/api/best"))).tracks;
}

export async function fetchMedia(folder: string): Promise<MediaFile[]> {
  return (await jsonOrThrow(await fetchRetry(`/api/media?folder=${encodeURIComponent(folder)}`))).files;
}

/** URL di stream. `version` (es. modifiedTime) evita che il browser riusi una copia in cache stantia. */
export function streamUrl(id: string, download = false, version?: string): string {
  return (
    `/api/stream?id=${encodeURIComponent(id)}` +
    (download ? "&download=1" : "") +
    (version ? `&v=${encodeURIComponent(version)}` : "")
  );
}

/** Miniatura di Drive (HEIC, video…): `size` = lato lungo in px. */
export function thumbUrl(id: string, size = 400): string {
  return `/api/thumb?id=${encodeURIComponent(id)}&s=${size}`;
}

/** PIN salvato sul telefono (se la band ha impostato UPLOAD_PIN). */
export function storedPin(): string {
  try {
    return localStorage.getItem("afdsa-pin") || "";
  } catch {
    return "";
  }
}

/** Sposta un file nel cestino di Drive. Lancia un Error con messaggio leggibile se fallisce. */
export async function deleteDriveFile(id: string): Promise<void> {
  const res = await fetchRetry(`/api/file?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-pin": storedPin() },
  });
  await jsonOrThrow(res);
}

/** Rinomina un file. Ritorna il nome effettivamente salvato (ripulito dal server). */
export async function renameDriveFile(id: string, name: string): Promise<string> {
  const res = await fetchRetry(`/api/file?id=${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-pin": storedPin() },
    body: JSON.stringify({ name }),
  });
  return (await jsonOrThrow(res)).name || name;
}
