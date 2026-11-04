"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { MediaFile } from "@/lib/library";
import { deleteDriveFile, renameDriveFile, streamUrl, thumbUrl } from "@/lib/library";
import { isWebImage } from "@/lib/mime";
import { splitNameExt } from "@/lib/format";

export default function MediaGrid({ files: initialFiles }: { files: MediaFile[] }) {
  const [files, setFiles] = useState<MediaFile[]>(initialFiles);
  const [viewer, setViewer] = useState<string | null>(null); // id foto aperta

  function handleDelete(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }
  function handleRename(id: string, newName: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name: newName } : f)));
  }

  const photos = files.filter((f) => f.subfolder === "foto");
  const videos = files.filter((f) => f.subfolder === "video");
  const viewIdx = viewer ? photos.findIndex((p) => p.id === viewer) : -1;

  if (files.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      {photos.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-sand/50">
            Foto · {photos.length}
          </p>
          <div className="grid grid-cols-3 gap-1">
            {photos.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setViewer(f.id)}
                className="relative aspect-square overflow-hidden rounded-lg bg-dark-bg/60 transition active:scale-[0.97]"
                aria-label={`Apri foto ${f.name}`}
              >
                <Thumb file={f} />
              </button>
            ))}
          </div>
        </div>
      )}
      {videos.length > 0 && (
        <div>
          <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-sand/50">
            Video · {videos.length}
          </p>
          <div className="flex flex-col gap-3">
            {videos.map((f) => (
              <VideoCard key={f.id} file={f} onDelete={handleDelete} onRename={handleRename} />
            ))}
          </div>
        </div>
      )}

      {viewIdx >= 0 && (
        <PhotoViewer
          photos={photos}
          index={viewIdx}
          onIndex={(i) => setViewer(photos[i]?.id ?? null)}
          onClose={() => setViewer(null)}
          onDeleted={(id) => {
            // dopo l'eliminazione passa alla foto successiva (o chiudi se era l'ultima)
            const next = photos[viewIdx + 1] ?? photos[viewIdx - 1];
            handleDelete(id);
            setViewer(next && next.id !== id ? next.id : null);
          }}
        />
      )}
    </div>
  );
}

/* ─── Visualizzatore foto a schermo intero ─── */

function PhotoViewer({
  photos,
  index,
  onIndex,
  onClose,
  onDeleted,
}: {
  photos: MediaFile[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const file = photos[index];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchX, setTouchX] = useState<number | null>(null);

  useEffect(() => {
    setConfirm(false);
    setError(null);
  }, [file.id]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [index, photos.length, onClose, onIndex]);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteDriveFile(file.id);
      onDeleted(file.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eliminazione non riuscita");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Foto"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        setTouchX(null);
        if (dx < -50 && index < photos.length - 1) onIndex(index + 1);
        if (dx > 50 && index > 0) onIndex(index - 1);
      }}
    >
      <div
        className="flex items-center justify-between px-3 pb-2 text-white"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Chiudi"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
        >
          <CloseIcon />
        </button>
        <span className="text-sm text-white/70">
          {index + 1} / {photos.length}
        </span>
        <span className="w-10" />
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <FullImage key={file.id} file={file} />
      </div>

      <div
        className="flex flex-col gap-2 px-4 pt-3"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        {error && <p className="text-center text-sm text-coral">{error}</p>}
        {confirm ? (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-white/80">Eliminare questa foto?</p>
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="rounded-lg bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "…" : "Elimina"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="rounded-lg px-3 py-2 text-sm text-white/60"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-4">
            <ShareButton file={file} large />
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label="Elimina"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 transition active:scale-95"
            >
              <TrashIcon size={18} />
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─── Immagini: miniatura di Drive (anche HEIC) con ripieghi ─── */

function Thumb({ file }: { file: MediaFile }) {
  const web = isWebImage(file.name, file.mimeType);
  // prima la miniatura di Drive (leggera, funziona con HEIC); se manca e il formato è "web", l'originale
  const [src, setSrc] = useState<string | null>(file.hasThumbnail ? thumbUrl(file.id, 400) : web ? streamUrl(file.id) : null);
  if (!src) return <span className="flex h-full w-full items-center justify-center text-2xl">📷</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setSrc(web && !src.startsWith("/api/stream") ? streamUrl(file.id) : null)}
    />
  );
}

function FullImage({ file }: { file: MediaFile }) {
  const web = isWebImage(file.name, file.mimeType);
  // formati che il browser sa mostrare → originale; HEIC & co. → miniatura grande di Drive
  const [src, setSrc] = useState<string | null>(web ? streamUrl(file.id) : thumbUrl(file.id, 2000));
  if (!src) return <p className="text-sm text-white/60">Anteprima non disponibile 😕</p>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={file.name}
      className="max-h-full max-w-full object-contain"
      onError={() => setSrc(src.startsWith("/api/thumb") ? null : thumbUrl(file.id, 2000))}
    />
  );
}

/* ─── Video ─── */

function VideoCard({
  file,
  onDelete,
  onRename,
}: {
  file: MediaFile;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteDriveFile(file.id);
      onDelete(file.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eliminazione non riuscita");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setEditing(true);
    setConfirm(false);
    setError(null);
    const { base } = splitNameExt(file.name);
    setEditVal(base);
  }

  async function saveRename() {
    if (!editVal.trim()) { setEditing(false); return; }
    const { ext } = splitNameExt(file.name);
    const newName = ext ? `${editVal.trim()}.${ext}` : editVal.trim();
    if (newName === file.name) { setEditing(false); return; }
    setBusy(true);
    setError(null);
    try {
      onRename(file.id, await renameDriveFile(file.id, newName));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rinomina non riuscita");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card overflow-hidden p-0">
      {unplayable ? (
        <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black px-4 text-center">
          {file.hasThumbnail && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={thumbUrl(file.id, 800)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
          )}
          <p className="relative text-sm text-sand/80">Questo telefono non riesce a riprodurre il video 😕</p>
          <a
            href={streamUrl(file.id, true)}
            download={file.name}
            className="relative rounded-lg bg-sky/20 px-3 py-1.5 text-xs font-semibold text-sky"
          >
            Scaricalo e aprilo con un&apos;altra app
          </a>
        </div>
      ) : (
        <video
          src={streamUrl(file.id)}
          poster={file.hasThumbnail ? thumbUrl(file.id, 800) : undefined}
          controls
          playsInline
          // con la copertina non serve scaricare nulla finché non si preme play (risparmia dati)
          preload={file.hasThumbnail ? "none" : "metadata"}
          onError={() => setUnplayable(true)}
          className="w-full bg-black"
          style={{ maxHeight: 260 }}
        />
      )}

      {error && <p className="px-3 pt-2 text-xs text-coral">{error}</p>}

      {editing ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveRename();
              if (e.key === "Escape") setEditing(false);
            }}
            enterKeyHint="done"
            className="field flex-1 text-sm"
          />
          <button
            type="button"
            onClick={saveRename}
            disabled={busy}
            className="shrink-0 rounded-lg bg-sky/20 px-3 py-1.5 text-xs font-semibold text-sky disabled:opacity-40"
          >
            {busy ? "…" : "Salva"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="shrink-0 text-xs text-sand/50"
          >
            Annulla
          </button>
        </div>
      ) : confirm ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <p className="flex-1 text-xs text-sand/70">Eliminare questo video?</p>
          <button
            type="button"
            onClick={doDelete}
            disabled={busy}
            className="rounded-lg bg-coral/20 px-3 py-1.5 text-xs font-semibold text-coral disabled:opacity-40"
          >
            {busy ? "…" : "Sì, elimina"}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="text-xs text-sand/50"
          >
            No
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2">
          <p className="min-w-0 flex-1 truncate text-sm text-sand/70">{splitNameExt(file.name).base}</p>
          <button
            type="button"
            onClick={startEdit}
            aria-label="Rinomina"
            className="shrink-0 rounded-full p-1.5 text-sand/40 transition hover:text-sand"
          >
            <PencilIcon />
          </button>
          <ShareButton file={file} />
          <button
            type="button"
            onClick={() => setConfirm(true)}
            aria-label="Elimina"
            className="shrink-0 rounded-full p-1.5 text-sand/40 transition hover:text-coral"
          >
            <TrashIcon size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── ShareButton ─── */

function download(file: MediaFile) {
  // download diretto dal server (nome file corretto via Content-Disposition), senza blob in memoria
  const a = document.createElement("a");
  a.href = streamUrl(file.id, true);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ShareButton({ file, large }: { file: MediaFile; large?: boolean }) {
  const [busy, setBusy] = useState(false);
  // webm non è condivisibile su iOS/WhatsApp: meglio scaricarlo
  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    !file.mimeType.startsWith("video/webm");

  async function handleClick() {
    if (!canShareFiles) return download(file);
    setBusy(true);
    try {
      const res = await fetch(streamUrl(file.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const f = new File([blob], file.name, { type: file.mimeType });
      if (navigator.canShare && !navigator.canShare({ files: [f] })) return download(file);
      await navigator.share({ files: [f], title: file.name });
    } catch (e) {
      // annullato dall'utente → niente; altri errori (es. attivazione utente scaduta) → scarica
      if (!(e instanceof DOMException && e.name === "AbortError")) download(file);
    } finally {
      setBusy(false);
    }
  }

  const label = canShareFiles ? "Condividi" : "Scarica";
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className={
        large
          ? "flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 transition active:scale-95 disabled:opacity-40"
          : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dark-bg/80 text-sand/60 transition hover:text-sand active:scale-95 disabled:opacity-40"
      }
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sand/30 border-t-sand" />
      ) : canShareFiles ? (
        <ShareIcon />
      ) : (
        <DownloadIcon />
      )}
    </button>
  );
}

/* ─── Icone ─── */

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function TrashIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
