// Store CLIENT della coda di upload.
// Vive a livello di modulo (non nello state della pagina) così:
//  - cambiando tab (Carica ↔ Prove) la coda e gli upload in corso non si perdono;
//  - una registrazione fermata mentre si cambia pagina arriva comunque in coda;
//  - i file non ancora caricati sono salvati in IndexedDB e tornano dopo un reload/chiusura app.
// Flusso "senza attrito": registri → (si carica da solo) → dici che pezzo era quando vuoi;
// se il file è già su Drive viene rinominato.
import { uploadOne } from "./upload";
import { renameDriveFile } from "./library";
import { rememberSong } from "./songs";
import { buildFileName, timeLabel, todayIso } from "./format";
import { kindOf } from "./mime";

export type Status = "ready" | "uploading" | "done" | "error";

export interface QueueItem {
  id: string;
  file: Blob;
  base: string; // nome senza estensione ("prova" per le registrazioni)
  ext: string;
  time: string; // "HH.mm.ss" del momento di acquisizione
  day: string; // "YYYY-MM-DD" del momento di acquisizione
  size: number;
  label: string; // che pezzo è (può arrivare anche dopo l'upload)
  status: Status;
  progress: number; // 0..1
  subfolder?: "video" | "foto"; // audio → cartella radice della prova
  error?: string;
  driveId?: string; // id del file su Drive dopo l'upload
  uploadedName?: string; // nome con cui è stato caricato (per capire se va rinominato)
  renaming?: boolean;
}

export interface QueueState {
  items: QueueItem[];
  uploading: boolean;
  recording: boolean;
  date: string; // data della prova scelta
  nextLabel: string; // etichetta scelta PRIMA di registrare (vale per la prossima cattura)
  who: string;
  pin: string;
  autoUpload: boolean;
  lastFolder: { id: string; name: string; link: string } | null;
  restoredCount: number; // file recuperati da una sessione precedente
}

let state: QueueState = {
  items: [],
  uploading: false,
  recording: false,
  date: todayIso(),
  nextLabel: "",
  who: "",
  pin: "",
  autoUpload: true,
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
const find = (id: string) => state.items.find((i) => i.id === id);

function saveLocal(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* ignora */
  }
}

export function setDate(date: string) {
  set({ date });
}
export function setNextLabel(nextLabel: string) {
  set({ nextLabel });
}
export function setWho(who: string) {
  set({ who });
  saveLocal("afdsa-who", who);
}
export function setPin(pin: string) {
  set({ pin });
  saveLocal("afdsa-pin", pin);
}
export function setAutoUpload(autoUpload: boolean) {
  set({ autoUpload });
  saveLocal("afdsa-auto", autoUpload ? "1" : "0");
  if (autoUpload) void uploadAll();
}
export function setRecording(recording: boolean) {
  set({ recording });
}
export function dismissRestored() {
  set({ restoredCount: 0 });
}

export function nameFor(item: QueueItem, who = state.who): string {
  return buildFileName({ time: item.time, who, label: item.label, base: item.base, ext: item.ext });
}

export function addBlob(file: Blob, base: string, ext: string): QueueItem {
  const kind = kindOf(ext ? `x.${ext}` : "", file.type);
  const subfolder = kind === "video" ? "video" : kind === "image" ? "foto" : undefined;
  const item: QueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    file,
    base,
    ext,
    time: timeLabel(),
    day: todayIso(),
    size: file.size,
    label: state.nextLabel,
    status: "ready",
    progress: 0,
    subfolder,
  };
  if (item.label) rememberSong(item.label);
  // in cima: l'ultima registrazione è quella a cui si vuole dare il nome
  set({ items: [item, ...state.items], nextLabel: "" });
  void idbPut(item);
  if (state.autoUpload) void uploadAll();
  return item;
}

export function removeItem(id: string) {
  set({ items: state.items.filter((i) => i.id !== id) });
  void idbDelete(id);
}

export function clearDone() {
  set({ items: state.items.filter((i) => i.status !== "done") });
}

/** Imposta "che pezzo è". Se il file è già su Drive, lo rinomina. */
export function setItemLabel(id: string, label: string) {
  const clean = label.trim();
  const item = find(id);
  if (!item) return;
  patch(id, { label: clean, error: item.status === "done" ? undefined : item.error });
  if (clean) rememberSong(clean);
  const updated = find(id)!;
  if (updated.status === "done") void syncName(id);
  else void idbPut(updated);
}

/** Allinea il nome su Drive all'etichetta attuale (dopo upload o cambio etichetta). */
async function syncName(id: string) {
  const item = find(id);
  if (!item || item.status !== "done" || !item.driveId || item.renaming) return;
  const wanted = nameFor(item);
  if (wanted === item.uploadedName) return;
  patch(id, { renaming: true, error: undefined });
  try {
    const saved = await renameDriveFile(item.driveId, wanted);
    patch(id, { renaming: false, uploadedName: saved });
    // l'etichetta potrebbe essere cambiata di nuovo nel frattempo
    if (nameFor(find(id) ?? item) !== saved) void syncName(id);
  } catch (e) {
    patch(id, {
      renaming: false,
      error: `Nome non aggiornato su Drive: ${e instanceof Error ? e.message : "errore"}`,
    });
  }
}

/** Riprova un singolo file andato in errore. */
export function retryItem(id: string) {
  const item = find(id);
  if (!item) return;
  if (item.status === "done") return void syncName(id);
  patch(id, { status: "ready", error: undefined });
  void uploadAll();
}

export async function uploadAll() {
  if (state.uploading) return;
  set({ uploading: true });
  const tried = new Set<string>();
  // Sequenziale (il primo upload crea la cartella della data, gli altri la riusano).
  // Prende sempre il prossimo in attesa: così entrano anche i file aggiunti durante il caricamento.
  for (;;) {
    const item = [...state.items]
      .reverse() // dal più vecchio
      // "error" già tentati in questo giro si saltano; quelli rimessi in "ready" (Riprova) no
      .find((i) => i.status === "ready" || (i.status === "error" && !tried.has(i.id)));
    if (!item) break;
    tried.add(item.id);
    patch(item.id, { status: "uploading", progress: 0, error: undefined });
    const fileName = nameFor(item);
    try {
      let last = 0;
      const session = await uploadOne(
        {
          rehearsalDate: state.date,
          fileName,
          file: item.file,
          subfolder: item.subfolder,
          pin: state.pin,
        },
        (frac) => {
          // limita i re-render: aggiorna ogni ~1%
          if (frac - last >= 0.01 || frac === 1) {
            last = frac;
            patch(item.id, { progress: frac });
          }
        },
      );
      patch(item.id, {
        status: "done",
        progress: 1,
        driveId: session.file.id,
        uploadedName: session.file.name || fileName,
      });
      set({ lastFolder: { id: session.folderId, name: session.folderName, link: session.folderWebViewLink } });
      void idbDelete(item.id);
      // nome cambiato mentre si caricava → rinomina su Drive
      void syncName(item.id);
    } catch (e) {
      patch(item.id, { status: "error", error: e instanceof Error ? e.message : "Errore" });
    }
  }
  set({ uploading: false });
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

type Persisted = Pick<
  QueueItem,
  "id" | "file" | "base" | "ext" | "time" | "day" | "size" | "subfolder" | "label"
>;

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
    label: item.label,
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

/** Una volta per sessione: preferenze salvate + file rimasti in coda da una visita precedente. */
export async function restoreQueue() {
  if (restored) return;
  restored = true;
  try {
    set({
      who: localStorage.getItem("afdsa-who") || "",
      pin: localStorage.getItem("afdsa-pin") || "",
      autoUpload: localStorage.getItem("afdsa-auto") !== "0",
    });
  } catch {
    /* ignora */
  }
  try {
    const recs = (await withStore("readonly", (s) => s.getAll())) as Persisted[];
    const known = new Set(state.items.map((i) => i.id));
    const fresh = recs
      .filter((r) => r && r.file && !known.has(r.id))
      .map<QueueItem>((r) => ({ ...r, label: r.label ?? "", status: "ready", progress: 0 }))
      .sort((a, b) => (b.day + b.time).localeCompare(a.day + a.time));
    if (!fresh.length) return;
    // i file recuperati appartengono alla prova del giorno in cui sono stati registrati
    // (NON si caricano da soli: prima l'utente controlla la data)
    set({
      items: [...state.items, ...fresh],
      date: state.items.length ? state.date : fresh[fresh.length - 1].day,
      restoredCount: fresh.length,
    });
  } catch {
    /* ignora */
  }
}
