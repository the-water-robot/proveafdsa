"use client";

import { useState } from "react";
import type { MediaFile } from "@/lib/library";
import { streamUrl } from "@/lib/library";

export default function MediaGrid({ files }: { files: MediaFile[] }) {
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
              <PhotoThumb key={f.id} file={f} />
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
              <VideoCard key={f.id} file={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoThumb({ file }: { file: MediaFile }) {
  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg bg-dark-bg/60">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={streamUrl(file.id)}
        alt={file.name}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      <div className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/40 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100 group-active:opacity-100">
        <ShareButton file={file} />
      </div>
    </div>
  );
}

function VideoCard({ file }: { file: MediaFile }) {
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
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="truncate text-sm text-sand/70">{file.name}</p>
        <ShareButton file={file} />
      </div>
    </div>
  );
}

function ShareButton({ file }: { file: MediaFile }) {
  const [busy, setBusy] = useState(false);

  async function share() {
    setBusy(true);
    try {
      if (typeof navigator.share === "function") {
        // Scarica il file e lo passa alla share sheet nativa (iOS/Android → sceglie Instagram)
        const res = await fetch(streamUrl(file.id));
        const blob = await res.blob();
        const f = new File([blob], file.name, { type: file.mimeType });
        await navigator.share({ files: [f], title: file.name });
      } else {
        // Fallback desktop: scarica il file
        const a = document.createElement("a");
        a.href = streamUrl(file.id, true);
        a.download = file.name;
        a.click();
      }
    } catch {
      /* utente ha annullato o browser non supporta */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={busy}
      title="Condividi (Instagram, WhatsApp, …)"
      aria-label="Condividi"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dark-bg/80 text-sand/60 transition hover:text-sand active:scale-95 disabled:opacity-40"
    >
      {busy ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sand/30 border-t-sand" />
      ) : (
        <ShareIcon />
      )}
    </button>
  );
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
