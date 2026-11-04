// Store CLIENT della coda di upload.
// Vive a livello di modulo (non nello state della pagina) così:
//  - cambiando tab (Carica ↔ Prove) la coda e gli upload in corso non si perdono;
//  - una registrazione fermata mentre si cambia pagina arriva comunque in coda;
//  - i file non ancora caricati sono salvati in IndexedDB e tornano dopo un reload/chiusura app.
import { uploadOne } from "./upload";
import { buildFileName, timeLabel, todayIso } from "./format";

export type Status = "ready" | "uploading" | "done" | "error";

export interface QueueItem {
  id: string;
  file: Blob;
  base: string; // nome senza estensione ("prova" per le registrazioni)
  ext: string;
  time: string; // "HH.mm.ss" del momento di acquisizione
  day: string; // "YYYY-MM-DD" del momento di acquisizione
  size: number;
  status: Status;
  progress: number; // 0..1
  subfolder?: "video" | "foto"; // audio → cartella radice della prova
  error?: string;
}

export interface QueueState {
  items: QueueItem[];
  uploading: boolean;
  recording: boolean;
  date: string; // data della prova scelta
  label: string;
  lastFolder: { id: string; name: string; link: string } | null;
  restoredCount: number; // file recuperati da una sessione precedente
}

let state: QueueState = {
  items: [],
  uploading: false,
  recording: false,
  date: todayIso(),
  label: "",
  lastFolder: null,
  restoredCount: 0,
};
const SERVER_STATE: QueueState = { ...state };

const listeners = new Set<() => void>();

function set(p: Partial<QueueState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export const getSnapshot = () => state;
export const getServerSnapshot = () => SERVER_STATE;

function patch(id: string, p: Partial<QueueItem>) {
  set({ items: state.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
}

export function setDate(date: string) {
  set({ date });
}
export function setLabel(label: string) {
  set({ label });
}
export function setRecording(recording: boolean) {
  set({ recording });
}
export function dismissRestored() {
  set({ restoredCount: 0 });
}

export function nameFor(item: QueueItem, who: string, label: string): string {
  return buildFileName({ time: item.time, who, label, base: item.base, ext: item.ext });
}

export function addBlob(file: Blob, base: string, ext: string) {
  const type = file.type || "";
  const subfolder = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "foto" : undefined;
  const item: QueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    base,
    ext,
    time: timeLabel(),
    day: todayIso(),
    size: file.size,
    status: "ready",
    progress: 0,
    subfolder,
  };
  // nuova aggiunta → togli dalla vista quelli già caricati
  set({ items: [...state.items.filter((i) => i.status !== "done"), item], lastFolder: null });
  void idbPut(item);
}

export function removeItem(id: string) {
  set({ items: state.items.filter((i) => i.id !== id) });
  void idbDelete(id);
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export async function uploadAll(opts: { who: string; pin: string }) {
  if (state.uploading) return;
  if (clearTimer) clearTimeout(clearTimer);
  set({ uploading: true });
  const { date, label } = state;
  // Sequenziale: il primo upload crea la cartella della data, gli altri la riusano.
  const pending = state.items.filter((i) => i.status === "ready" || i.status === "error");
  for (const item of pending) {
    if (!state.items.some((i) => i.id === item.id)) continue;
    patch(item.id, { status: "uploading", progress: 0, error: undefined });
    try {
      let last = 0;
      const session = await uploadOne(
        {
          rehearsalDate: date,
          fileName: nameFor(item, opts.who, label),
          file: item.file,
          subfolder: item.subfolder,
          pin: opts.pin,
        },
        (frac) => {
          // limita i re-render: aggiorna ogni ~1%
          if (frac - last >= 0.01 || frac === 1) {
            last = frac;
            patch(item.id, { progress: frac });
          }
        },
      );
      patch(item.id, { status: "done", progress: 1 });
      set({ lastFolder: { id: session.folderId, name: session.folderName, link: session.folderWebViewLink } });
      void idbDelete(item.id);
    } catch (e) {
      patch(item.id, { status: "error", error: e instanceof Error ? e.message : "Errore" });
    }
  }
  set({ uploading: false });

  if (state.items.length > 0 && state.items.every((i) => i.status === "done")) {
    // Dopo 2,5 s: azzera etichetta e togli i file caricati dalla lista
    clearTimer = setTimeout(() => {
      set({ label: "", items: state.items.filter((i) => i.status !== "done") });
    }, 2500);
  }
}

/* ─────────────  Persistenza IndexedDB (best-effort)  ───────────── */

const DB_NAME = "afdsa";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}

type Persisted = Pick<QueueItem, "id" | "file" | "base" | "ext" | "time" | "day" | "size" | "subfolder">;

async function idbPut(item: QueueItem) {
  const rec: Persisted = {
    id: item.id,
    file: item.file,
    base: item.base,
    ext: item.ext,
    time: item.time,
    day: item.day,
    size: item.size,
    subfolder: item.subfolder,
  };
  try {
    await withStore("readwrite", (s) => s.put(rec));
  } catch {
    /* quota piena o IDB non disponibile: la coda resta solo in memoria */
  }
}

async function idbDelete(id: string) {
  try {
    await withStore("readwrite", (s) => s.delete(id));
  } catch {
    /* ignora */
  }
}

let restored = false;

/** Recupera (una volta per sessione) i file rimasti in coda da una visita precedente. */
export async function restoreQueue() {
  if (restored) return;
  restored = true;
  try {
    const recs = (await withStore("readonly", (s) => s.getAll())) as Persisted[];
    const known = new Set(state.items.map((i) => i.id));
    const fresh = recs
      .filter((r) => r && r.file && !known.has(r.id))
      .map<QueueItem>((r) => ({ ...r, status: "ready", progress: 0 }))
      .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
    if (!fresh.length) return;
    // i file recuperati appartengono alla prova del giorno in cui sono stati registrati
    set({
      items: [...fresh, ...state.items],
      date: state.items.length ? state.date : fresh[0].day,
      restoredCount: fresh.length,
    });
  } catch {
    /* ignora */
  }
}
