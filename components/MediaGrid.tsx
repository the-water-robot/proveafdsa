"use client";

import { useState } from "react";
import type { MediaFile } from "@/lib/library";
import { streamUrl } from "@/lib/library";
import { splitNameExt } from "@/lib/format";

export default function MediaGrid({ files: initialFiles }: { files: MediaFile[] }) {
  const [files, setFiles] = useState<MediaFile[]>(initialFiles);

  function handleDelete(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }
  function handleRename(id: string, newName: string) {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name: newName } : f)));
  }

  const photos = files.filter((f) => f.subfolder === "foto");
  const videos = files.filter((f) => f.subfolder === "video");

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
              <PhotoThumb key={f.id} file={f} onDelete={handleDelete} />
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
    </div>
  );
}

/* ─── Foto ─── */

function PhotoThumb({
  file,
  onDelete,
}: {
  file: MediaFile;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/file?id=${file.id}`, { method: "DELETE" });
      if (res.ok) onDelete(file.id);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg bg-dark-bg/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={streamUrl(file.id)}
        alt={file.name}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/50 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100 group-active:opacity-100">
        {confirm ? (
          <div className="flex w-full items-center justify-between gap-1">
            <button
              type="button"
              onClick={doDelete}
              disabled={busy}
              className="flex-1 rounded-lg bg-coral/90 py-1.5 text-[10px] font-semibold text-white active:scale-95 disabled:opacity-50"
            >
              {busy ? "…" : "Sì"}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(false)}
              className="flex-1 rounded-lg bg-dark-bg/80 py-1.5 text-[10px] font-semibold text-sand active:scale-95"
            >
              No
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              title="Elimina"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-dark-bg/80 text-sand/60 transition hover:text-coral active:scale-95"
            >
              <TrashIcon size={13} />
            </button>
            <ShareButton file={file} />
          </>
        )}
      </div>
    </div>
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

  async function doDelete() {
    setBusy(true);
    try {
      const res = await fetch(`/api/file?id=${file.id}`, { method: "DELETE" });
      if (res.ok) onDelete(file.id);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  function startEdit() {
    setEditing(true);
    setConfirm(false);
    const { base } = splitNameExt(file.name);
    setEditVal(base);
  }

  async function saveRename() {
    if (!editVal.trim()) { setEditing(false); return; }
    const { ext } = splitNameExt(file.name);
    const newName = ext ? `${editVal.trim()}.${ext}` : editVal.trim();
    setBusy(true);
    try {
      const res = await fetch(`/api/file?id=${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (res.ok) onRename(file.id, newName);
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }

  return (
    <div className="card overflow-hidden p-0">
      <video
        src={streamUrl(file.id)}
        controls
        playsInline
        preload="metadata"
        className="w-full"
        style={{ maxHeight: 260 }}
      />

      {editing ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            autoFocus
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveRename()}
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
          <p className="truncate text-sm text-sand/70">{file.name}</p>
          <button
            type="button"
            onClick={startEdit}
            title="Rinomina"
            className="shrink-0 rounded-full p-1.5 text-sand/40 transition hover:text-sand"
          >
            <PencilIcon />
          </button>
          <ShareButton file={file} />
          <button
            type="button"
            onClick={() => setConfirm(true)}
            title="Elimina"
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

function ShareButton({ file }: { file: MediaFile }) {
  const [busy, setBusy] = useState(false);
  const isWebm = file.mimeType.startsWith("video/webm");

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch(streamUrl(file.id));
      const blob = await res.blob();
      if (isWebm) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        return;
      }
      const f = new File([blob], file.name, { type: file.mimeType });
      if (typeof navigator.share === "function") {
        await navigator.share({ files: [f], title: file.name });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
      }
    } catch { /* annullato */ } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={isWebm ? "Scarica" : "Condividi"}
      aria-label={isWebm ? "Scarica" : "Condividi"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dark-bg/80 text-sand/60 transition hover:text-sand active:scale-95 disabled:opacity-40"
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sand/30 border-t-sand" />
      ) : isWebm ? (
        <DownloadIcon />
      ) : (
        <ShareIcon />
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
