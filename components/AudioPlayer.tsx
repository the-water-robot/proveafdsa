"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioFile } from "@/lib/library";
import { streamUrl } from "@/lib/library";
import { splitNameExt } from "@/lib/format";
import TrimModal from "@/components/TrimModal";

function mmss(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function prettyName(name: string): string {
  return splitNameExt(name).base || name;
}
function formatBytes(n: number): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ─── Componente principale ─── */

export default function AudioPlayer({ tracks: initial }: { tracks: AudioFile[] }) {
  const [tracks, setTracks] = useState<AudioFile[]>(initial);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loop, setLoop] = useState(false);

  /* edit state */
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  /* trim modal */
  const [trimTrack, setTrimTrack] = useState<AudioFile | null>(null);

  /* delete confirm */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const current = index >= 0 && index < tracks.length ? tracks[index] : null;

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    a.src = streamUrl(current.id);
    a.load();
    setTime(0); setDur(0);
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function selectTrack(i: number) {
    if (i === index) togglePlay();
    else setIndex(i);
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().then(() => setPlaying(true)).catch(() => {});
    else a.pause();
  }
  function onEnded() {
    if (index < tracks.length - 1) setIndex(index + 1);
    else setPlaying(false);
  }
  function onError() {
    if (current) setFailed((s) => new Set(s).add(current.id));
    setPlaying(false);
  }

  /* ─── Delete ─── */
  async function doDelete(id: string) {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/file?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        const newTracks = tracks.filter((t) => t.id !== id);
        setTracks(newTracks);
        if (current?.id === id) {
          const a = audioRef.current;
          if (a) { a.pause(); a.src = ""; }
          setPlaying(false);
          setIndex(-1);
        }
      }
    } finally {
      setDeleteBusy(false);
      setConfirmDeleteId(null);
    }
  }

  /* ─── Rename ─── */
  function openEdit(t: AudioFile) {
    setEditId(t.id);
    setEditName(splitNameExt(t.name).base);
    setConfirmDeleteId(null);
  }
  async function saveRename(id: string) {
    const track = tracks.find((t) => t.id === id);
    if (!track || !editName.trim()) { setEditId(null); return; }
    const { ext } = splitNameExt(track.name);
    const newName = ext ? `${editName.trim()}.${ext}` : editName.trim();
    setRenameBusy(true);
    try {
      const res = await fetch(`/api/file?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (res.ok) setTracks((prev) => prev.map((t) => t.id === id ? { ...t, name: newName } : t));
    } finally {
      setRenameBusy(false);
      setEditId(null);
    }
  }

  /* ─── Trim (gestito in TrimModal) ─── */

  if (tracks.length === 0) {
    return <p className="text-sm text-sand/50">Ancora nessun file audio in questa prova.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <audio
        ref={audioRef}
        loop={loop}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onEnded={onEnded}
        onError={onError}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        preload="none"
        hidden
      />

      <ol className="flex flex-col gap-1.5">
        {tracks.map((t, i) => {
          const active = i === index;
          const bad = failed.has(t.id);
          const isEdit = editId === t.id;
          const isConfirmDel = confirmDeleteId === t.id;

          return (
            <li key={t.id}>
              {/* Riga principale */}
              <div className={`card flex items-center gap-3 p-3 ${active ? "ring-1 ring-flamingo/50" : ""}`}>
                <button
                  type="button"
                  onClick={() => selectTrack(i)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-flamingo to-tangerine text-white"
                  aria-label={active && playing ? "Pausa" : "Riproduci"}
                >
                  {active && playing ? <PauseGlyph /> : <PlayGlyph />}
                </button>

                <button type="button" onClick={() => selectTrack(i)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{`${i + 1}. ${prettyName(t.name)}`}</p>
                  <p className="text-xs text-sand/50">
                    {active && dur ? `${mmss(time)} / ${mmss(dur)}` : formatBytes(t.size)}
                    {bad && <span className="text-coral"> · non riproducibile, scarica ▾</span>}
                  </p>
                </button>

                <a
                  href={streamUrl(t.id, true)}
                  download
                  className="shrink-0 rounded-full p-2 text-sand/40 transition hover:text-sky"
                  aria-label="Scarica"
                >
                  <DownloadGlyph />
                </a>
                <button
                  type="button"
                  onClick={() => isEdit ? setEditId(null) : openEdit(t)}
                  className={`shrink-0 rounded-full p-2 transition ${isEdit ? "text-sky" : "text-sand/40 hover:text-sand"}`}
                  aria-label="Modifica"
                >
                  <PencilGlyph />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(isConfirmDel ? null : t.id)}
                  className={`shrink-0 rounded-full p-2 transition ${isConfirmDel ? "text-coral" : "text-sand/40 hover:text-coral"}`}
                  aria-label="Elimina"
                >
                  <TrashGlyph />
                </button>
              </div>

              {/* Slider playback */}
              {active && (
                <input
                  type="range" min={0} max={dur || 0} step={0.1} value={time}
                  onChange={(e) => {
                    const a = audioRef.current; if (!a) return;
                    const v = Number(e.target.value); a.currentTime = v; setTime(v);
                  }}
                  className="mt-1.5 w-full accent-flamingo"
                  aria-label="Avanzamento"
                />
              )}

              {/* Conferma eliminazione */}
              {isConfirmDel && (
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-coral/30 bg-coral/10 px-3 py-2.5">
                  <p className="flex-1 text-xs text-sand/80">Eliminare questa registrazione?</p>
                  <button
                    type="button"
                    onClick={() => doDelete(t.id)}
                    disabled={deleteBusy}
                    className="rounded-lg bg-coral/20 px-3 py-1.5 text-xs font-semibold text-coral disabled:opacity-40"
                  >
                    {deleteBusy ? "…" : "Sì, elimina"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-sand/50"
                  >
                    No
                  </button>
                </div>
              )}

              {/* Pannello edit */}
              {isEdit && (
                <div className="mt-1 flex flex-col gap-2 rounded-xl border border-dark-border bg-dark-bg/60 px-3 py-3">
                  {/* Rinomina */}
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-sand/40">Rinomina</p>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveRename(t.id)}
                      className="field flex-1 text-sm"
                      placeholder="Nome file"
                    />
                    <button
                      type="button"
                      onClick={() => saveRename(t.id)}
                      disabled={renameBusy}
                      className="shrink-0 rounded-xl bg-sky/20 px-3 py-2 text-sm font-semibold text-sky disabled:opacity-40"
                    >
                      {renameBusy ? "…" : "Salva"}
                    </button>
                  </div>
                  {/* Taglia */}
                  <button
                    type="button"
                    onClick={() => { setEditId(null); setTrimTrack(t); }}
                    className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dark-border py-2.5 text-sm text-sand/60 transition hover:text-sand"
                  >
                    <ScissorsIcon /> Taglia audio…
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* TrimModal */}
      {trimTrack && (
        <TrimModal
          track={trimTrack}
          onClose={() => setTrimTrack(null)}
          onOverwrite={(updated) => {
            setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setTrimTrack(null);
          }}
        />
      )}

      {/* Player bar fisso */}
      {current && (
        <div className="card sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-between p-3">
          <button
            type="button"
            onClick={() => setLoop((v) => !v)}
            aria-pressed={loop}
            aria-label={loop ? "Ripeti traccia: attivo" : "Ripeti traccia"}
            className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
              loop ? "bg-sky/20 text-sky ring-1 ring-sky/40" : "text-sand/40 hover:text-sand/70"
            }`}
          >
            <LoopGlyph />
          </button>

          <div className="flex items-center gap-8">
            <button
              type="button"
              onClick={() => index > 0 && setIndex(index - 1)}
              disabled={index <= 0}
              className="text-sand transition disabled:opacity-30"
              aria-label="Precedente"
            >
              <PrevGlyph />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-flamingo to-tangerine text-white shadow-lg"
              aria-label="Play/Pausa"
            >
              {playing ? <PauseGlyph big /> : <PlayGlyph big />}
            </button>
            <button
              type="button"
              onClick={() => index < tracks.length - 1 && setIndex(index + 1)}
              disabled={index >= tracks.length - 1}
              className="text-sand transition disabled:opacity-30"
              aria-label="Successivo"
            >
              <NextGlyph />
            </button>
          </div>

          <div className="w-9" aria-hidden />
        </div>
      )}
    </div>
  );
}

/* ─── Glyphs ─── */
function PlayGlyph({ big }: { big?: boolean }) {
  const s = big ? 22 : 16;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseGlyph({ big }: { big?: boolean }) {
  const s = big ? 22 : 16;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
}
function PrevGlyph() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6v12l-9-6z" /></svg>;
}
function NextGlyph() {
  return <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l9 6-9 6z" /></svg>;
}
function DownloadGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
    </svg>
  );
}
function PencilGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}
function TrashGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
  );
}
function ScissorsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}
function LoopGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
