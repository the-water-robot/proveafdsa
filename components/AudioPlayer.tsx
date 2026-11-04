"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioFile } from "@/lib/library";
import { deleteDriveFile, renameDriveFile, streamUrl } from "@/lib/library";
import { formatBytes, prettyFolderDate, splitNameExt } from "@/lib/format";
import { isMember, memberLabel } from "@/lib/band";
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
/** "22.19.35 — Rosa — prova.webm" → "ore 22:19" */
function recordedAt(name: string): string {
  const m = /^(\d{2})\.(\d{2})\.\d{2}\b/.exec(name);
  return m ? `ore ${m[1]}:${m[2]}` : "";
}
/** "22.19.35 — Rosa — prova.webm" → "Rosa" (titolo per auto / schermata di blocco). */
function songTitle(name: string): string {
  const parts = prettyName(name).split(" — ").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^\d{2}\.\d{2}\.\d{2}$/.test(parts[0])) parts.shift();
  if (parts.length > 1 && /^(prova|video|foto)$/i.test(parts[parts.length - 1])) parts.pop();
  if (parts.length > 1 && isMember(parts[0])) parts.shift(); // "pit — Rosa" → "Rosa" (chi è mostrato a parte)
  return parts.join(" — ") || prettyName(name);
}
/** Chi ha registrato (secondo segmento del nome, se è un membro della band). */
function recordedBy(name: string): string {
  const parts = prettyName(name).split(" — ").map((p) => p.trim());
  const i = /^\d{2}\.\d{2}\.\d{2}$/.test(parts[0] ?? "") ? 1 : 0;
  return parts.length > i + 1 && isMember(parts[i]) ? memberLabel(parts[i]) : "";
}

/* ─── Componente principale ─── */

export default function AudioPlayer({
  tracks: initial,
  folderName,
}: {
  tracks: AudioFile[];
  folderName: string;
}) {
  const [tracks, setTracks] = useState<AudioFile[]>(initial);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Traccia corrente per id (non per indice: eliminando/aggiungendo file l'indice slitterebbe)
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; msg: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false); // in attesa di dati (avvio, salto, rete lenta)
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

  const index = currentId ? tracks.findIndex((t) => t.id === currentId) : -1;
  const current = index >= 0 ? tracks[index] : null;

  // Ref per i gestori di eventi media / Media Session (non devono vedere stato vecchio)
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const currentIdRef = useRef<string | null>(null);
  const fixingDurRef = useRef(false); // sto ricavando la durata di un webm che non la dichiara
  const wantPlayRef = useRef(false);

  /** Carica una traccia. play() è chiamato subito, nello stesso evento: su iOS serve perché
   *  il passaggio al pezzo successivo funzioni anche a schermo bloccato / in auto. */
  function load(t: AudioFile, autoplay: boolean) {
    const a = audioRef.current;
    if (!a) return;
    currentIdRef.current = t.id;
    setCurrentId(t.id);
    fixingDurRef.current = false;
    wantPlayRef.current = autoplay;
    a.src = streamUrl(t.id, false, t.modifiedTime);
    setTime(0);
    setDur(0);
    setLoading(autoplay);
    if (autoplay) a.play().catch(() => setPlaying(false));
  }
  function setIndex(i: number) {
    const t = tracksRef.current[i];
    if (t) load(t, true);
  }
  function step(dir: 1 | -1) {
    const list = tracksRef.current;
    const i = list.findIndex((t) => t.id === currentIdRef.current);
    const t = list[i + dir];
    if (t) load(t, true);
    return Boolean(t);
  }
  function seekBy(sec: number) {
    const a = audioRef.current;
    if (!a || !isFinite(a.duration)) return;
    a.currentTime = Math.max(0, Math.min(a.duration - 0.1, a.currentTime + sec));
  }
  function selectTrack(i: number) {
    if (i === index) togglePlay();
    else setIndex(i);
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (!currentIdRef.current) return setIndex(0);
    if (a.paused) {
      wantPlayRef.current = true;
      if (a.readyState < 3) setLoading(true);
      a.play().catch(() => setLoading(false));
    } else {
      wantPlayRef.current = false;
      a.pause();
    }
  }
  function onEnded() {
    if (fixingDurRef.current) return;
    if (!step(1)) {
      wantPlayRef.current = false;
      setPlaying(false);
    }
  }
  function onError() {
    if (current) setFailed((s) => new Set(s).add(current.id));
    setPlaying(false);
    setLoading(false);
  }

  /* ─── Durata: i webm registrati dal browser non la dichiarano (durata "infinita") ─── */
  function onLoadedMetadata(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    if (isFinite(a.duration)) {
      setDur(a.duration);
      syncPosition();
      return;
    }
    // trucco standard: salta oltre la fine, il browser calcola la durata reale, poi torna a 0
    fixingDurRef.current = true;
    a.currentTime = 1e101;
  }
  function onDurationChange(e: React.SyntheticEvent<HTMLAudioElement>) {
    const a = e.currentTarget;
    if (!isFinite(a.duration) || a.duration <= 0) return;
    setDur(a.duration);
    if (fixingDurRef.current) {
      fixingDurRef.current = false;
      setLoading(false); // se serve altro buffering arriverà un nuovo "waiting"
      a.currentTime = 0;
      if (wantPlayRef.current && a.paused) a.play().catch(() => {});
    }
    syncPosition();
  }

  /* ─── Integrazione con auto / CarPlay / Bluetooth / schermata di blocco (Media Session) ─── */
  function syncPosition() {
    const a = audioRef.current;
    if (!a || !("mediaSession" in navigator) || !isFinite(a.duration) || a.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        position: Math.min(a.currentTime, a.duration),
        playbackRate: a.playbackRate || 1,
      });
    } catch {
      /* ignora */
    }
  }

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, h);
      } catch {
        /* azione non supportata */
      }
    };
    set("play", () => togglePlayRef.current(true));
    set("pause", () => togglePlayRef.current(false));
    // Volutamente NIENTE seekbackward/seekforward: su iPhone/CarPlay sostituirebbero
    // i tasti "brano precedente/successivo" con ±15 s. In auto è più utile saltare tra i pezzi.
    set("previoustrack", () => {
      const a = audioRef.current;
      if (a && a.currentTime > 3) a.currentTime = 0;
      else step(-1);
    });
    set("nexttrack", () => step(1));
    set("seekto", (d) => {
      const a = audioRef.current;
      if (a && d.seekTime != null && isFinite(a.duration)) a.currentTime = d.seekTime;
    });
    return () => {
      for (const a of ["play", "pause", "previoustrack", "nexttrack", "seekto"] as MediaSessionAction[]) set(a, null);
      ms.metadata = null;
      ms.playbackState = "none";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePlayRef = useRef((play: boolean) => {
    const a = audioRef.current;
    if (!a) return;
    wantPlayRef.current = play;
    if (play) a.play().catch(() => {});
    else a.pause();
  });

  useEffect(() => {
    if (!("mediaSession" in navigator) || !current || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: songTitle(current.name),
      artist: "Animali Fantastici del Sud America",
      album: `Prova · ${prettyFolderDate(folderName)}`,
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  }, [current?.id, current?.name, folderName]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Delete ─── */
  async function doDelete(id: string) {
    setDeleteBusy(true);
    setActionError(null);
    try {
      await deleteDriveFile(id);
      setTracks((prev) => prev.filter((t) => t.id !== id));
      if (currentIdRef.current === id) {
        currentIdRef.current = null;
        wantPlayRef.current = false;
        const a = audioRef.current;
        if (a) { a.pause(); a.removeAttribute("src"); a.load(); }
        setPlaying(false);
        setCurrentId(null);
      }
      setConfirmDeleteId(null);
    } catch (e) {
      setActionError({ id, msg: e instanceof Error ? e.message : "Eliminazione non riuscita" });
    } finally {
      setDeleteBusy(false);
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
    if (newName === track.name) { setEditId(null); return; }
    setRenameBusy(true);
    setActionError(null);
    try {
      const saved = await renameDriveFile(id, newName);
      setTracks((prev) => prev.map((t) => t.id === id ? { ...t, name: saved } : t));
      setEditId(null);
    } catch (e) {
      setActionError({ id, msg: e instanceof Error ? e.message : "Rinomina non riuscita" });
    } finally {
      setRenameBusy(false);
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
        onTimeUpdate={(e) => !fixingDurRef.current && setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={onDurationChange}
        onSeeked={syncPosition}
        onWaiting={() => wantPlayRef.current && setLoading(true)}
        onPlaying={() => !fixingDurRef.current && setLoading(false)}
        onCanPlay={(e) => e.currentTarget.paused && !fixingDurRef.current && setLoading(false)}
        onEnded={onEnded}
        onError={onError}
        onPause={() => {
          if (fixingDurRef.current) return;
          setPlaying(false);
          setLoading(false);
          if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
        }}
        onPlay={() => {
          setPlaying(true);
          if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
          syncPosition();
        }}
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
                  className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-flamingo to-tangerine text-white"
                  aria-label={active && playing ? "Pausa" : "Riproduci"}
                  aria-busy={active && loading}
                >
                  {active && loading && <Spinner />}
                  {active && playing ? <PauseGlyph /> : <PlayGlyph />}
                </button>

                <button type="button" onClick={() => selectTrack(i)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{`${i + 1}. ${songTitle(t.name)}`}</p>
                  <p className="text-xs text-sand/50">
                    {active && dur > 0
                      ? `${mmss(time)} / ${mmss(dur)}`
                      : [recordedAt(t.name), recordedBy(t.name), formatBytes(t.size)].filter(Boolean).join(" · ")}
                    {bad && <span className="text-coral"> · non riproducibile, scarica ▾</span>}
                  </p>
                </button>

                <a
                  href={streamUrl(t.id, true, t.modifiedTime)}
                  download={t.name}
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

              {actionError?.id === t.id && (
                <p className="mt-1 px-1 text-xs text-coral">{actionError.msg}</p>
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(t.id);
                        if (e.key === "Escape") setEditId(null);
                      }}
                      enterKeyHint="done"
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
          folderName={folderName}
          onClose={() => setTrimTrack(null)}
          onOverwrite={(updated) => {
            setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            const a = audioRef.current;
            if (a && currentIdRef.current === updated.id) load(updated, !a.paused);
          }}
          onSavedNew={(added) => {
            setTracks((prev) => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)));
          }}
        />
      )}

      {/* Player bar fisso */}
      {current && (
        <div className="card sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex flex-col gap-1 bg-dark-card/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <p className="min-w-0 truncate text-sm font-semibold">{songTitle(current.name)}</p>
            <p className="shrink-0 font-mono text-xs tabular-nums text-sand/50">
              {loading ? "carico…" : `${mmss(time)} / ${dur > 0 ? mmss(dur) : "–:––"}`}
            </p>
          </div>
          <input
            type="range"
            min={0}
            max={dur || 1}
            step={0.1}
            value={Math.min(time, dur || 0)}
            disabled={!(dur > 0)}
            onChange={(e) => {
              const a = audioRef.current;
              if (!a) return;
              const v = Number(e.target.value);
              a.currentTime = v;
              setTime(v);
            }}
            className="w-full accent-flamingo disabled:opacity-40"
            aria-label="Avanzamento"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setLoop((v) => !v)}
              aria-pressed={loop}
              aria-label={loop ? "Ripeti traccia: attivo" : "Ripeti traccia"}
              className={`flex h-10 w-10 items-center justify-center rounded-full transition ${
                loop ? "bg-sky/20 text-sky ring-1 ring-sky/40" : "text-sand/40 hover:text-sand/70"
              }`}
            >
              <LoopGlyph />
            </button>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={index <= 0}
              className="flex h-10 w-10 items-center justify-center text-sand transition disabled:opacity-30"
              aria-label="Pezzo precedente"
            >
              <PrevGlyph />
            </button>
            <button
              type="button"
              onClick={() => seekBy(-15)}
              disabled={!(dur > 0)}
              className="flex h-10 w-10 items-center justify-center text-sand/80 transition disabled:opacity-30"
              aria-label="Indietro 15 secondi"
            >
              <SkipGlyph back />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-flamingo to-tangerine text-white shadow-lg transition active:scale-95"
              aria-label={playing ? "Pausa" : "Riproduci"}
              aria-busy={loading}
            >
              {loading && <Spinner />}
              {playing ? <PauseGlyph big /> : <PlayGlyph big />}
            </button>
            <button
              type="button"
              onClick={() => seekBy(15)}
              disabled={!(dur > 0)}
              className="flex h-10 w-10 items-center justify-center text-sand/80 transition disabled:opacity-30"
              aria-label="Avanti 15 secondi"
            >
              <SkipGlyph />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={index >= tracks.length - 1}
              className="flex h-10 w-10 items-center justify-center text-sand transition disabled:opacity-30"
              aria-label="Pezzo successivo"
            >
              <NextGlyph />
            </button>
            <span className="w-10" aria-hidden />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Glyphs ─── */
/** Anello che gira attorno al pulsante play mentre l'audio si carica. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-[5px] animate-spin rounded-full border-[3px] border-flamingo/20 border-t-sand"
    />
  );
}
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
function SkipGlyph({ back }: { back?: boolean }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={back ? undefined : { transform: "scaleX(-1)" }}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" style={back ? undefined : { transform: "scaleX(-1)", transformOrigin: "12px 12px" }}>15</text>
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
