"use client";

import { useEffect, useRef, useState } from "react";
import type { AudioFile } from "@/lib/library";
import { streamUrl } from "@/lib/library";
import { splitNameExt } from "@/lib/format";
import { putResumable } from "@/lib/upload";

function mmss(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function encodeWAV(buf: AudioBuffer, s0: number, s1: number): Blob {
  const sr = buf.sampleRate;
  const ch = buf.numberOfChannels;
  const i0 = Math.max(0, Math.floor(s0 * sr));
  const i1 = Math.min(buf.length, Math.floor(s1 * sr));
  const n = Math.max(0, i1 - i0);
  const dataSize = n * ch * 2;
  const ab = new ArrayBuffer(44 + dataSize);
  const v = new DataView(ab);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + dataSize, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, buf.getChannelData(c)[i0 + i]));
      v.setInt16(off, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

function computePeaks(buffer: AudioBuffer, bins: number): Float32Array {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / bins));
  const peaks = new Float32Array(bins);
  for (let i = 0; i < bins; i++) {
    let max = 0;
    const s = i * step;
    const e = Math.min(s + step, data.length);
    for (let j = s; j < e; j++) max = Math.max(max, Math.abs(data[j]));
    peaks[i] = max;
  }
  return peaks;
}

interface Props {
  track: AudioFile;
  onClose: () => void;
  onOverwrite: (updated: AudioFile) => void;
}

export default function TrimModal({ track, onClose, onOverwrite }: Props) {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Frazioni 0..1 rispetto alla durata totale
  const [startFrac, setStartFrac] = useState(0);
  const [endFrac, setEndFrac] = useState(1);
  const startRef = useRef(0);
  const endRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newFileSaved, setNewFileSaved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);
  const rafRef = useRef<number>(0);
  const playCtxStartRef = useRef(0);
  const playAudioStartRef = useRef(0);
  const bufferRef = useRef<AudioBuffer | null>(null);

  /* ─── Load ─── */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(streamUrl(track.id));
        const ab = await res.arrayBuffer();
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const buf = await ctx.decodeAudioData(ab);
        if (cancelled) return;
        bufferRef.current = buf;
        setBuffer(buf);
        startRef.current = 0; endRef.current = 1;
        setStartFrac(0); setEndFrac(1);
        // peaks calcolati subito per il canvas
        const bins = Math.round((canvasRef.current?.offsetWidth ?? 320) * (window.devicePixelRatio || 1));
        peaksRef.current = computePeaks(buf, bins);
      } catch {
        if (!cancelled) setLoadError("Formato audio non decodificabile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      stopPlay();
      audioCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  /* ─── Draw ─── */
  useEffect(() => { if (buffer) draw(null); }, [buffer, startFrac, endFrac]);

  function draw(playheadFrac: number | null) {
    const canvas = canvasRef.current;
    const peaks = peaksRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const sX = startRef.current * W;
    const eX = endRef.current * W;
    const mid = H / 2;
    const bins = peaks.length;
    const bw = W / bins;

    // Waveform
    for (let i = 0; i < bins; i++) {
      const x = i * bw;
      const h = Math.max(2, peaks[i] * H * 0.85);
      const inSel = x + bw > sX && x < eX;
      ctx.fillStyle = inSel ? "rgba(232,128,74,0.9)" : "rgba(255,255,255,0.13)";
      ctx.fillRect(x, mid - h / 2, Math.max(1, bw - 0.5), h);
    }

    // Sfondo scuro fuori dalla selezione
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, sX, H);
    ctx.fillRect(eX, 0, W - eX, H);

    // Handle sinistro
    ctx.fillStyle = "#fff";
    ctx.fillRect(sX - 1.5, 0, 3, H);
    ctx.beginPath();
    ctx.moveTo(sX - 1, 4); ctx.lineTo(sX + 14, 4); ctx.lineTo(sX - 1, H - 4); ctx.closePath();
    ctx.fill();

    // Handle destro
    ctx.fillRect(eX - 1.5, 0, 3, H);
    ctx.beginPath();
    ctx.moveTo(eX + 1, 4); ctx.lineTo(eX - 14, 4); ctx.lineTo(eX + 1, H - 4); ctx.closePath();
    ctx.fill();

    // Playhead
    if (playheadFrac !== null) {
      const px = Math.max(0, Math.min(1, playheadFrac)) * W;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(px - 1, 0, 2, H);
    }

    ctx.restore();
  }

  /* ─── Animazione playhead ─── */
  function animatePlayhead() {
    const ctx = audioCtxRef.current;
    const buf = bufferRef.current;
    if (!ctx || !buf) return;
    const elapsed = ctx.currentTime - playCtxStartRef.current;
    const audioTime = playAudioStartRef.current + elapsed;
    const frac = audioTime / buf.duration;
    if (frac >= endRef.current) { stopPlay(); return; }
    draw(frac);
    rafRef.current = requestAnimationFrame(animatePlayhead);
  }

  /* ─── Playback ─── */
  function play() {
    const ctx = audioCtxRef.current;
    const buf = bufferRef.current;
    if (!ctx || !buf) return;
    stopPlay();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const s0 = startRef.current * buf.duration;
    const dur = (endRef.current - startRef.current) * buf.duration;
    playCtxStartRef.current = ctx.currentTime;
    playAudioStartRef.current = s0;
    src.start(0, s0, dur);
    src.onended = () => { setPlaying(false); draw(null); };
    sourceRef.current = src;
    setPlaying(true);
    rafRef.current = requestAnimationFrame(animatePlayhead);
  }

  function stopPlay() {
    cancelAnimationFrame(rafRef.current);
    try { sourceRef.current?.stop(); } catch { /* già fermo */ }
    sourceRef.current = null;
    setPlaying(false);
  }

  /* ─── Drag handles ─── */
  function fracFromPointer(e: React.PointerEvent<HTMLCanvasElement>): number {
    const rect = canvasRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!bufferRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const x = fracFromPointer(e);
    const grab = 28 / (canvasRef.current?.clientWidth ?? 300);
    if (Math.abs(x - startRef.current) <= grab) {
      draggingRef.current = "start";
    } else if (Math.abs(x - endRef.current) <= grab) {
      draggingRef.current = "end";
    } else {
      // Assegna all'handle più vicino
      draggingRef.current =
        Math.abs(x - startRef.current) < Math.abs(x - endRef.current) ? "start" : "end";
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draggingRef.current) return;
    const x = fracFromPointer(e);
    const MIN = 0.01;
    if (draggingRef.current === "start") {
      const v = Math.min(x, endRef.current - MIN);
      startRef.current = v; setStartFrac(v);
    } else {
      const v = Math.max(x, startRef.current + MIN);
      endRef.current = v; setEndFrac(v);
    }
  }

  function onPointerUp() { draggingRef.current = null; }

  /* ─── Save: Sovrascrivi ─── */
  async function doOverwrite() {
    const buf = bufferRef.current;
    if (!buf) return;
    setSaveState("busy"); setSaveError(null);
    try {
      const wav = encodeWAV(buf, startRef.current * buf.duration, endRef.current * buf.duration);
      const { base } = splitNameExt(track.name);
      const newName = `${base}.wav`;
      const r = await fetch(`/api/file-session?id=${track.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimeType: "audio/wav", newName, origin: window.location.origin }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Errore ${r.status}`);
      const { sessionUrl } = await r.json();
      await putResumable(sessionUrl, wav);
      setSaveState("done");
      onOverwrite({ ...track, name: newName, size: wav.size, mimeType: "audio/wav" });
      setTimeout(onClose, 1400);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Errore");
      setSaveState("error");
    }
  }

  /* ─── Save: Nuovo file (download) ─── */
  function doSaveNew() {
    const buf = bufferRef.current;
    if (!buf) return;
    const wav = encodeWAV(buf, startRef.current * buf.duration, endRef.current * buf.duration);
    const { base } = splitNameExt(track.name);
    const url = URL.createObjectURL(wav);
    const a = document.createElement("a");
    a.href = url; a.download = `${base}-trim.wav`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setNewFileSaved(true);
  }

  const dur = buffer?.duration ?? 0;
  const selStart = startFrac * dur;
  const selEnd = endFrac * dur;
  const selDur = selEnd - selStart;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-auto w-full max-w-md rounded-t-2xl bg-[#1c1a18] shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-sand/35">Taglia audio</p>
            <p className="truncate text-sm font-medium text-sand">{splitNameExt(track.name).base}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-3 shrink-0 rounded-full p-2 text-sand/50 hover:text-sand">
            <XIcon />
          </button>
        </div>

        {/* Waveform */}
        <div className="px-4 pb-2">
          {loading ? (
            <div className="flex h-[88px] items-center justify-center rounded-xl bg-dark-bg/60">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-sand/20 border-t-sand/60" />
              <span className="ml-3 text-xs text-sand/40">Carico audio…</span>
            </div>
          ) : loadError ? (
            <div className="flex h-[88px] items-center justify-center rounded-xl bg-dark-bg/60">
              <p className="text-xs text-coral">{loadError}</p>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              className="h-[88px] w-full touch-none rounded-xl bg-dark-bg/60"
              style={{ cursor: "col-resize" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          )}
        </div>

        {/* Etichette tempo */}
        {buffer && (
          <div className="flex items-center justify-between px-5 text-xs">
            <span className="text-sand/40">{mmss(0)}</span>
            <span className="font-medium text-sand/80">
              {mmss(selStart)} – {mmss(selEnd)}
              <span className="ml-2 text-sand/40">({mmss(selDur)})</span>
            </span>
            <span className="text-sand/40">{mmss(dur)}</span>
          </div>
        )}

        {/* Play */}
        {buffer && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={playing ? stopPlay : play}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-flamingo to-tangerine text-white shadow-lg transition active:scale-95"
              aria-label={playing ? "Ferma" : "Ascolta selezione"}
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
        )}

        {/* Azioni salvataggio */}
        {buffer && (
          <div className="mt-5 flex flex-col gap-2.5 px-4 pb-4">
            {saveState === "done" ? (
              <p className="py-2 text-center font-semibold text-lime">Salvato ✓</p>
            ) : saveState === "error" ? (
              <>
                <p className="text-center text-sm text-coral">{saveError}</p>
                <button type="button" onClick={() => setSaveState("idle")} className="text-center text-xs text-sand/50">
                  Riprova
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={doOverwrite}
                  disabled={saveState === "busy"}
                  className="w-full rounded-xl bg-gradient-to-r from-flamingo to-tangerine py-3.5 text-sm font-semibold text-white shadow disabled:opacity-50"
                >
                  {saveState === "busy" ? "Salvo…" : "Sovrascrivi"}
                </button>
                <button
                  type="button"
                  onClick={doSaveNew}
                  disabled={saveState === "busy"}
                  className="w-full rounded-xl border border-white/10 py-3 text-sm font-semibold text-sand/80 transition hover:bg-white/5 disabled:opacity-50"
                >
                  {newFileSaved ? "Scaricato ✓ — ricaricare per aggiungerlo" : "Salva come nuovo file"}
                </button>
                {newFileSaved && (
                  <p className="text-center text-[10px] text-sand/30">
                    File .wav scaricato — aggiungilo via "Scegli file" nella schermata Carica.
                  </p>
                )}
              </>
            )}
            <button type="button" onClick={onClose} className="mt-0.5 text-center text-sm text-sand/35">
              Annulla
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
}
function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
