// Helper lato CLIENT per la sezione "Prove" (lista cartelle, file audio, metadati, streaming).
// Tutte le chiamate passano da un fetch con retry: i blip transitori (cold-start della funzione,
// 5xx momentanei) vengono ritentati e non disturbano l'utente.
import type { ProvaMeta } from "./band";

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

export async function fetchMedia(folder: string): Promise<MediaFile[]> {
  return (await jsonOrThrow(await fetchRetry(`/api/media?folder=${encodeURIComponent(folder)}`))).files;
}

export function streamUrl(id: string, download = false): string {
  return `/api/stream?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;
}
