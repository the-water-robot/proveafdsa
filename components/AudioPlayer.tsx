"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioFile } from "@/lib/library";
import { streamUrl } from "@/lib/library";
import { splitNameExt } from "@/lib/format";

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

export default function AudioPlayer({ tracks }: { tracks: AudioFile[] }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [loop, setLoop] = useState(false);

  const current = index >= 0 && index < tracks.length ? tracks[index] : null;

  // Cambio traccia → carica e prova a suonare (il primo play parte da un tap dell'utente).
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    a.src = streamUrl(current.id);
    a.load();
    setTime(0);
    setDur(0);
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
          return (
            <li key={t.id}>
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
                    {bad && <span className="text-coral"> · non riproducibile qui, scarica ▾</span>}
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
              </div>
              {active && (
                <input
                  type="range"
                  min={0}
                  max={dur || 0}
                  step={0.1}
                  value={time}
                  onChange={(e) => {
                    const a = audioRef.current;
                    if (!a) return;
                    const v = Number(e.target.value);
                    a.currentTime = v;
                    setTime(v);
                  }}
                  className="mt-1.5 w-full accent-flamingo"
                  aria-label="Avanzamento"
                />
              )}
            </li>
          );
        })}
      </ol>

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

/* glyphs */
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
function LoopGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
