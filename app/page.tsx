"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Recorder from "@/components/Recorder";
import { MEMBERS } from "@/lib/band";
import { extFromMime, formatBytes, prettyFolderDate, splitNameExt, todayIso } from "@/lib/format";
import {
  addBlob,
  dismissRestored,
  getServerSnapshot,
  getSnapshot,
  nameFor,
  removeItem,
  restoreQueue,
  setDate,
  setLabel,
  subscribe,
  uploadAll,
  type Status,
} from "@/lib/queue";

const SHARE_CACHE = "afdsa-shared";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Home() {
  const { items, uploading, recording, date, label, lastFolder, restoredCount } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const [who, setWho] = useState("");
  const [pinProtected, setPinProtected] = useState(false);
  const [pin, setPin] = useState("");
  const [configMissing, setConfigMissing] = useState<string[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carica preferenze locali + stato del server + coda salvata + eventuali file condivisi (share target)
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

    restoreQueue();
    importSharedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeWho(v: string) {
    setWho(v);
    localStorage.setItem("afdsa-who", v);
  }
  function changePin(v: string) {
    setPin(v);
    localStorage.setItem("afdsa-pin", v);
  }

  const pendingCount = items.filter((i) => i.status === "ready" || i.status === "error").length;
  const allDone = items.length > 0 && items.every((i) => i.status === "done");

  // Avviso prima di chiudere/ricaricare mentre si registra o si carica
  useEffect(() => {
    if (!recording && !uploading) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [recording, uploading]);

  const onRecorded = useCallback((blob: Blob) => {
    const type = blob.type || "";
    const base = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "foto" : "prova";
    addBlob(blob, base, extFromMime(type || "audio/webm"));
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      const { base, ext } = splitNameExt(f.name);
      addBlob(f, base || "file", ext || extFromMime(f.type));
    });
  }, []);

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

  const isToday = date === todayIso();
  const folderName = date.replace(/-/g, " ");

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-safe">
      <header className="flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" width={48} height={48} className="rounded-xl" />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold leading-tight">Prove</h1>
          <p className="text-sm text-sand/60">Animali Fantastici del Sud America</p>
        </div>
        <span className="text-xs text-sand/30 font-mono">v12</span>
      </header>

      {configMissing && configMissing.length > 0 && (
        <div className="card border-coral/50 bg-coral/10 p-4 text-sm">
          <p className="font-semibold text-coral">Configurazione server incompleta</p>
          <p className="mt-1 text-sand/70">
            Mancano le variabili: {configMissing.join(", ")}. Imposta le env su Vercel (vedi README).
          </p>
        </div>
      )}

      {restoredCount > 0 && (
        <div className="card flex items-start gap-3 border-solar/40 bg-solar/10 p-4 text-sm">
          <p className="flex-1 text-sand/80">
            <b className="text-solar">
              {restoredCount === 1 ? "1 file recuperato" : `${restoredCount} file recuperati`}
            </b>{" "}
            dall&apos;ultima volta: non erano ancora stati caricati. Controlla la data e premi Carica.
          </p>
          <button type="button" onClick={dismissRestored} className="text-sand/40" aria-label="Chiudi avviso">
            <CloseIcon />
          </button>
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
            onChange={(e) => e.target.value && setDate(e.target.value)}
            disabled={uploading}
            className="field"
          />
          <p className="mt-1 text-xs text-sand/50">
            {date && (
              <>
                {!isToday && <span className="font-semibold text-solar">Non è oggi · </span>}
                {prettyFolderDate(folderName)} → cartella <span className="font-mono">{folderName}</span>
              </>
            )}
          </p>
        </div>
        <div>
          <p className="label">
            Chi sei <span className="text-sand/40">(opz.)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {MEMBERS.map((m) => {
              const on = who.toLowerCase() === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => changeWho(on ? "" : m)}
                  aria-pressed={on}
                  className={`chip ${on ? "chip-on" : "chip-off"}`}
                >
                  {cap(m)}
                </button>
              );
            })}
          </div>
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
            placeholder="es. soundcheck, nuovo pezzo…"
            className="field"
          />
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
              onChange={(e) => changePin(e.target.value)}
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
          accept="audio/*,video/*,image/*"
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
            {allDone ? "Caricati" : `Da caricare (${pendingCount})`}
          </h2>
          {items.map((item) => (
            <div key={item.id} className="card flex items-center gap-3 p-3">
              <StatusDot status={item.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{nameFor(item, who, label)}</p>
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

      {lastFolder && (
        <div className="flex flex-col items-center gap-2">
          <Link
            href={`/prove/${lastFolder.id}?d=${encodeURIComponent(lastFolder.name)}`}
            className="w-full rounded-xl border border-sky/40 bg-sky/10 px-4 py-3 text-center text-sm font-semibold text-sky transition active:scale-[0.99]"
          >
            ▸ Ascolta / info di questa prova
          </Link>
          {lastFolder.link && (
            <a
              href={lastFolder.link}
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
              onClick={() => uploadAll({ who, pin })}
              disabled={uploading || recording}
              className="w-full rounded-xl bg-gradient-to-r from-flamingo to-tangerine px-4 py-3.5 text-base font-semibold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            >
              {uploading
                ? "Caricamento in corso…"
                : recording
                  ? "Ferma la registrazione per caricare"
                  : `Carica ${pendingCount} file su Drive`}
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
