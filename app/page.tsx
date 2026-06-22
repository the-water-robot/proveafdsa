"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Recorder from "@/components/Recorder";
import { uploadOne } from "@/lib/upload";
import {
  buildFileName,
  extFromMime,
  splitNameExt,
  timeLabel,
  todayIso,
} from "@/lib/format";

type Status = "ready" | "uploading" | "done" | "error";

interface QueueItem {
  id: string;
  file: Blob;
  base: string; // nome senza estensione ("prova" per le registrazioni)
  ext: string;
  time: string; // "HH.mm.ss" del momento di acquisizione
  size: number;
  status: Status;
  progress: number; // 0..1
  subfolder?: string; // "video" | "foto" | undefined (audio → cartella radice)
  error?: string;
  link?: string;
}

const SHARE_CACHE = "afdsa-shared";

export default function Home() {
  const [date, setDate] = useState(todayIso());
  const [who, setWho] = useState("");
  const [label, setLabel] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [folderLink, setFolderLink] = useState<string | null>(null);
  const [doneFolder, setDoneFolder] = useState<{ id: string; name: string } | null>(null);

  const [pinProtected, setPinProtected] = useState(false);
  const [pin, setPin] = useState("");
  const [configMissing, setConfigMissing] = useState<string[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carica preferenze locali + stato del server + eventuali file condivisi (share target)
  useEffect(() => {
    setWho(localStorage.getItem("afdsa-who") || "");
    setPin(localStorage.getItem("afdsa-pin") || "");

    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setPinProtected(Boolean(h.pinProtected));
        if (!h.ok) setConfigMissing(h.missing || []);
      })
      .catch(() => {});

    importSharedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem("afdsa-who", who);
  }, [who]);
  useEffect(() => {
    localStorage.setItem("afdsa-pin", pin);
  }, [pin]);

  const addBlob = useCallback((file: Blob, base: string, ext: string) => {
    const type = file.type || "";
    const subfolder = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "foto" : undefined;
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        base,
        ext,
        time: timeLabel(),
        size: file.size,
        status: "ready",
        progress: 0,
        subfolder,
      },
    ]);
    setFolderLink(null);
    setDoneFolder(null);
  }, []);

  const onRecorded = useCallback(
    (blob: Blob) => {
      const type = blob.type || "";
      const base = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "foto" : "prova";
      addBlob(blob, base, extFromMime(type || "audio/webm"));
    },
    [addBlob],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((f) => {
        const { base, ext } = splitNameExt(f.name);
        addBlob(f, base || "file", ext || extFromMime(f.type));
      });
    },
    [addBlob],
  );

  async function importSharedFiles() {
    try {
      if (!("caches" in window)) return;
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const collected: File[] = [];
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get("x-filename") || "condiviso");
        collected.push(new File([blob], name, { type: blob.type }));
        await cache.delete(req);
      }
      if (collected.length) addFiles(collected);
    } catch {
      /* ignora */
    } finally {
      if (location.search) history.replaceState(null, "", location.pathname);
    }
  }

  function nameFor(item: QueueItem): string {
    return buildFileName({ time: item.time, who, label, base: item.base, ext: item.ext });
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function patch(id: string, p: Partial<QueueItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }

  async function uploadAll() {
    if (uploading) return;
    setUploading(true);
    // Sequenziale: il primo upload crea la cartella della data, gli altri la riusano.
    const pending = items.filter((i) => i.status === "ready" || i.status === "error");
    for (const item of pending) {
      patch(item.id, { status: "uploading", progress: 0, error: undefined });
      try {
        const session = await uploadOne(
          { rehearsalDate: date, fileName: nameFor(item), file: item.file, subfolder: item.subfolder, pin },
          (frac) => patch(item.id, { progress: frac }),
        );
        patch(item.id, { status: "done", progress: 1, link: session.folderWebViewLink });
        setFolderLink(session.folderWebViewLink);
        setDoneFolder({ id: session.folderId, name: session.folderName });
      } catch (e) {
        patch(item.id, {
          status: "error",
          error: e instanceof Error ? e.message : "Errore",
        });
      }
    }
    setUploading(false);
  }

  const pendingCount = items.filter((i) => i.status === "ready" || i.status === "error").length;
  const allDone = items.length > 0 && items.every((i) => i.status === "done");

  // Dopo 2 secondi che tutto è caricato: azzera etichetta e rimuovi i file dalla lista
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => {
      setLabel("");
      setItems((prev) => prev.filter((i) => i.status !== "done"));
    }, 2000);
    return () => clearTimeout(t);
  }, [allDone]);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-6">
      <header className="flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" width={48} height={48} className="rounded-xl" />
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight">Prove</h1>
          <p className="text-sm text-sand/60">Animali Fantastici del Sud America</p>
        </div>
      </header>

      {configMissing && configMissing.length > 0 && (
        <div className="card border-coral/50 bg-coral/10 p-4 text-sm">
          <p className="font-semibold text-coral">Configurazione server incompleta</p>
          <p className="mt-1 text-sand/70">
            Mancano le variabili: {configMissing.join(", ")}. Imposta le env su Vercel (vedi README).
          </p>
        </div>
      )}

      {/* Dettagli prova */}
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <label className="label" htmlFor="date">
            Data della prova
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="field"
          />
          <p className="mt-1 text-xs text-sand/50">
            I file finiscono nella cartella <span className="font-mono">{date.replace(/-/g, " ")}</span> su Drive.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="who">
              Chi sei <span className="text-sand/40">(opz.)</span>
            </label>
            <input
              id="who"
              type="text"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              placeholder="es. Luca"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="label">
              Etichetta <span className="text-sand/40">(opz.)</span>
            </label>
            <input
              id="label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="es. soundcheck"
              className="field"
            />
          </div>
        </div>
        {pinProtected && (
          <div>
            <label className="label" htmlFor="pin">
              Codice di accesso
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="codice della band"
              className="field"
            />
          </div>
        )}
      </section>

      {/* Aggiungi */}
      <section className="card flex flex-col items-center gap-5 p-6">
        <Recorder onRecorded={onRecorded} />
        <div className="flex w-full items-center gap-3 text-xs text-sand/40">
          <span className="h-px flex-1 bg-dark-border" />
          oppure
          <span className="h-px flex-1 bg-dark-border" />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dark-border bg-dark-bg/60 px-4 py-3 font-medium text-sand transition active:scale-[0.98]"
        >
          <PaperclipIcon /> Scegli file
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {/* Coda */}
      {items.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-sand/70">
            Da caricare ({items.length})
          </h2>
          {items.map((item) => (
            <div key={item.id} className="card flex items-center gap-3 p-3">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{nameFor(item)}</p>
                <p className="text-xs text-sand/50">
                  {formatBytes(item.size)}
                  {item.status === "uploading" && ` · ${Math.round(item.progress * 100)}%`}
                  {item.status === "done" && " · caricato ✓"}
                  {item.status === "error" && (
                    <span className="text-coral"> · {item.error}</span>
                  )}
                </p>
                {item.status === "uploading" && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-dark-bg">
                    <div
                      className="h-full rounded-full bg-sky transition-all"
                      style={{ width: `${Math.round(item.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              {(item.status === "ready" || item.status === "error") && !uploading && (
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="shrink-0 rounded-full p-1.5 text-sand/40 transition hover:text-coral"
                  aria-label="Rimuovi"
                >
                  <CloseIcon />
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {(doneFolder || folderLink) && (
        <div className="flex flex-col items-center gap-2">
          {doneFolder && (
            <Link
              href={`/prove/${doneFolder.id}?d=${encodeURIComponent(doneFolder.name)}`}
              className="w-full rounded-xl border border-sky/40 bg-sky/10 px-4 py-3 text-center text-sm font-semibold text-sky transition active:scale-[0.99]"
            >
              ▸ Ascolta / info di questa prova
            </Link>
          )}
          {folderLink && (
            <a
              href={folderLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-sand/60 underline-offset-4 hover:underline"
            >
              Apri la cartella su Google Drive ↗
            </a>
          )}
        </div>
      )}

      {/* Barra azione fissa */}
      {pendingCount > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-dark-border bg-dark-bg/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={uploadAll}
              disabled={uploading}
              className="w-full rounded-xl bg-gradient-to-r from-flamingo to-tangerine px-4 py-3.5 text-base font-semibold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            >
              {uploading
                ? "Caricamento in corso…"
                : `Carica ${pendingCount} ${pendingCount === 1 ? "file" : "file"} su Drive`}
            </button>
          </div>
        </div>
      )}

      {allDone && !uploading && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-lime/30 bg-dark-bg/90 px-4 py-4 text-center backdrop-blur">
          <p className="font-semibold text-lime">Tutto caricato ✓</p>
        </div>
      )}
    </main>
  );
}

/* ---------- piccoli componenti di supporto ---------- */

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === "done"
      ? "bg-lime"
      : status === "error"
        ? "bg-coral"
        : status === "uploading"
          ? "bg-sky animate-pulse"
          : "bg-sand/30";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
