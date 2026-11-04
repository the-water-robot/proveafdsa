"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import fixWebmDuration from "fix-webm-duration";
import { setRecording as setGlobalRecording } from "@/lib/queue";

type Mode = "audio" | "video" | "foto";
const MODES: Mode[] = ["audio", "video", "foto"];
const MODE_LABEL: Record<Mode, string> = { audio: "Audio", video: "Video", foto: "Foto" };

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignora */ }
  }
  return "";
}

function pickVideoMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(c)) return c; } catch { /* ignora */ }
  }
  return "";
}

// Per la MUSICA vanno spenti i filtri "da telefonata" che i browser attivano di default:
// la soppressione del rumore mangia piatti e chitarre, il controllo automatico del guadagno
// fa "pompare" il volume, la cancellazione dell'eco taglia frequenze. Memo Vocali non li usa.
const MUSIC_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 2 },
  sampleRate: { ideal: 48000 },
};
const AUDIO_BITRATE = 192_000; // default dei browser ~128 kbps o meno

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Recorder({ onRecorded }: { onRecorded: (blob: Blob) => void }) {
  const [mode, setMode] = useState<Mode>("audio");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [fullscreen, setFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // copia reattiva dello stream (per l'indicatore di livello)
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);
  const [checkingLevel, setCheckingLevel] = useState(false);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchX = useRef<number | null>(null);
  const fsOverlayRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function onFsChange() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        setFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  async function enterFullscreen() {
    setFullscreen(true);
    requestAnimationFrame(async () => {
      const el = fsOverlayRef.current;
      if (!el) return;
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if ((el as any).webkitRequestFullscreen) (el as any).webkitRequestFullscreen();
      } catch { /* browser non supporta */ }
    });
  }

  async function exitFullscreen() {
    setFullscreen(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (document.exitFullscreen) await document.exitFullscreen();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if ((document as any).webkitExitFullscreen) (document as any).webkitExitFullscreen();
      }
    } catch { /* ignora */ }
  }

  async function acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      }
    } catch { /* non supportato o permesso negato */ }
  }
  async function releaseWakeLock() {
    try { await wakeLockRef.current?.release(); } catch { /* ignora */ }
    wakeLockRef.current = null;
  }

  useEffect(() => {
    if (mode === "audio") {
      if (!recording) stopStream();
    } else {
      openCamera(facingMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Stato "sto registrando" visibile al resto dell'app (tab bar, avviso di chiusura)
  useEffect(() => {
    setGlobalRecording(recording);
  }, [recording]);

  // Il wake lock viene rilasciato dal browser quando la pagina va in background: riprendilo al ritorno
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible" && recRef.current?.state === "recording") acquireWakeLock();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(
    () => () => {
      // Smontaggio (es. cambio tab) durante una registrazione: chiudila in modo pulito,
      // così onstop consegna comunque il file alla coda.
      const rec = recRef.current;
      if (rec && rec.state !== "inactive") {
        try { rec.stop(); } catch { /* ignora */ }
      }
      stopTimer();
      releaseWakeLock();
      setGlobalRecording(false);
      // lascia a onstop il tempo di raccogliere l'ultimo chunk prima di chiudere i track
      const s = streamRef.current;
      setTimeout(() => s?.getTracks().forEach((t) => t.stop()), 300);
      streamRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }
  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLiveStream(null);
    setCameraReady(false);
  }

  /** Apre solo il microfono (senza registrare) per posizionare il telefono guardando il livello. */
  async function toggleLevelCheck() {
    setError(null);
    if (streamRef.current) {
      stopStream();
      return;
    }
    setCheckingLevel(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MUSIC_AUDIO });
      streamRef.current = stream;
      setLiveStream(stream);
    } catch {
      setError("Microfono non disponibile o permesso negato.");
    } finally {
      setCheckingLevel(false);
    }
  }

  async function openCamera(facing: "environment" | "user" = "environment") {
    if (streamRef.current?.getVideoTracks().length) {
      attachPreview(streamRef.current);
      setCameraReady(true);
      return;
    }
    // stream solo-audio (controllo livello) → chiudilo e apri camera+microfono
    if (streamRef.current) stopStream();
    setCameraReady(false);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: MUSIC_AUDIO,
      });
      streamRef.current = stream;
      setLiveStream(stream);
      attachPreview(stream);
      setCameraReady(true);
    } catch {
      setError("Fotocamera non disponibile o permesso negato.");
    }
  }

  async function flipCamera() {
    if (recording) return;
    const newFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newFacing);
    stopStream();
    await openCamera(newFacing);
  }

  function attachPreview(stream: MediaStream) {
    if (previewRef.current) {
      previewRef.current.srcObject = stream;
      previewRef.current.play().catch(() => {});
    }
  }

  const setPreview = useCallback((node: HTMLVideoElement | null) => {
    previewRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  function cycleMode(dir: 1 | -1) {
    if (recording) return;
    setError(null);
    setMode((prev) => MODES[(MODES.indexOf(prev) + dir + MODES.length) % MODES.length]);
  }

  function onTouchStart(e: React.TouchEvent) {
    touchX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (Math.abs(dx) > 50) cycleMode(dx < 0 ? 1 : -1);
  }

  async function handlePress() {
    setError(null);

    if (mode === "foto") {
      await takePhoto().catch((e) => setError(e instanceof Error ? e.message : "Errore"));
      return;
    }

    if (recording) {
      recRef.current?.stop();
      return;
    }

    try {
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia(
          mode === "video" ? { audio: MUSIC_AUDIO, video: { facingMode } } : { audio: MUSIC_AUDIO },
        );
        streamRef.current = stream;
        setLiveStream(stream);
        if (mode === "video") attachPreview(stream);
      }

      const mime = mode === "video" ? pickVideoMime() : pickAudioMime();
      const opts: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
      if (mime) opts.mimeType = mime;
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, opts);
      } catch {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      }
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mime || (mode === "video" ? "video/webm" : "audio/webm");
        const blob = new Blob(chunksRef.current, { type });
        stopTimer();
        releaseWakeLock();
        if (mode === "audio") stopStream();
        setRecording(false);
        setElapsed(0);
        if (blob.size === 0) return;
        // I webm del MediaRecorder non contengono la durata: i player la vedono "infinita"
        // (niente barra di avanzamento, niente durata in auto/schermata di blocco). La scriviamo noi.
        if (type.includes("webm")) {
          fixWebmDuration(blob, performance.now() - startedAt, { logger: false })
            .then((fixed) => onRecorded(fixed.size ? new Blob([fixed], { type }) : blob))
            .catch(() => onRecorded(blob));
        } else {
          onRecorded(blob);
        }
      };
      const startedAt = performance.now();
      rec.start();
      acquireWakeLock();
      recRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setError(`${mode === "video" ? "Fotocamera" : "Microfono"} non disponibile o permesso negato.`);
    }
  }

  async function takePhoto() {
    const stream = streamRef.current;
    const video = previewRef.current;
    if (!stream || !video) throw new Error("Fotocamera non pronta.");

    const track = stream.getVideoTracks()[0];
    let blob: Blob;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (window as any).ImageCapture !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ic = new (window as any).ImageCapture(track);
      blob = await ic.takePhoto();
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("Canvas vuoto"))), "image/jpeg", 0.9),
      );
    }
    if (blob.size > 0) onRecorded(blob);
  }

  const modeIdx = MODES.indexOf(mode);

  async function handlePressFullscreen() {
    await handlePress();
    if (mode === "foto") await exitFullscreen();
  }

  const captureBtn = (
    <button
      type="button"
      onClick={fullscreen ? handlePressFullscreen : handlePress}
      className="relative flex h-28 w-28 items-center justify-center rounded-full transition active:scale-95"
      aria-label={
        mode === "foto"
          ? "Scatta foto"
          : recording
          ? "Ferma registrazione"
          : `Avvia registrazione ${MODE_LABEL[mode]}`
      }
    >
      {recording && (
        <span className="absolute inset-0 rounded-full bg-coral/40 animate-pulse-ring" />
      )}
      <span
        className={`relative flex h-28 w-28 items-center justify-center rounded-full shadow-lg ${
          recording
            ? "bg-coral"
            : mode === "foto"
            ? "bg-gradient-to-br from-violet to-sky"
            : "bg-gradient-to-br from-flamingo to-tangerine"
        }`}
      >
        {recording ? (
          <span className="h-8 w-8 rounded-md bg-white" />
        ) : mode === "audio" ? (
          <MicIcon />
        ) : mode === "video" ? (
          <VideoIcon />
        ) : (
          <CameraIcon />
        )}
      </span>
    </button>
  );

  return (
    <>
      {/* Overlay fullscreen — portal nel body, fuori da qualsiasi stacking context */}
      {mounted && fullscreen && mode !== "audio" && createPortal(
        <div
          ref={fsOverlayRef}
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 9999, background: "black",
          }}
        >
          {/* Video riempie tutto — pointer-events:none lascia passare i tocchi */}
          <video
            ref={setPreview}
            autoPlay
            muted
            playsInline
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover",
              pointerEvents: "none",
            }}
          />

          {/* Bottoni in cima */}
          <div
            style={{
              position: "absolute", top: 0, left: 0, right: 0,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "max(14px, env(safe-area-inset-top)) 14px 10px",
            }}
          >
            {!recording ? (
              <button
                type="button"
                onClick={exitFullscreen}
                aria-label="Indietro"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-90"
              >
                <CollapseIcon />
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                {mmss(elapsed)}
              </span>
            )}
            {cameraReady && !recording && (
              <button
                type="button"
                onClick={flipCamera}
                aria-label="Cambia fotocamera"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-90"
              >
                <FlipCameraIcon />
              </button>
            )}
          </div>

          {/* Bottone scatto sovrapposto al video in basso */}
          <div
            style={{
              position: "absolute", left: 0, right: 0,
              bottom: "max(36px, env(safe-area-inset-bottom))",
              display: "flex", justifyContent: "center",
            }}
          >
            {captureBtn}
          </div>
        </div>,
        document.body
      )}

      <div
        className="flex w-full flex-col items-center gap-3 select-none"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Anteprima camera (video/foto mode) */}
        {mode !== "audio" && (
          <div
            className="relative w-full overflow-hidden rounded-xl bg-black"
            style={{ aspectRatio: "4/3" }}
          >
            {!fullscreen && (
              <video
                ref={setPreview}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            )}
            {!cameraReady && !fullscreen && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                {error ? (
                  <>
                    <p className="text-sm text-coral">{error}</p>
                    <button
                      type="button"
                      onClick={() => openCamera(facingMode)}
                      className="rounded-lg border border-dark-border px-3 py-1.5 text-xs font-medium text-sand/80"
                    >
                      Riprova
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-sand/50">Apertura fotocamera…</p>
                )}
              </div>
            )}
            {cameraReady && !recording && !fullscreen && (
              <button
                type="button"
                onClick={flipCamera}
                aria-label="Cambia fotocamera"
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-90"
              >
                <FlipCameraIcon />
              </button>
            )}
            {/* Bottone fullscreen */}
            {cameraReady && !recording && !fullscreen && (
              <button
                type="button"
                onClick={enterFullscreen}
                aria-label="Schermo intero"
                className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:scale-90"
              >
                <ExpandIcon />
              </button>
            )}
            {recording && !fullscreen && (
              <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                {mmss(elapsed)}
              </span>
            )}
          </div>
        )}

        {/* Pulsante di registrazione / scatto (normale, non fullscreen) */}
        {!fullscreen && captureBtn}

        {/* Indicatore di livello del microfono */}
        {!fullscreen && mode !== "foto" && liveStream && <LevelMeter stream={liveStream} />}

        {/* Testo stato */}
        {!fullscreen && (
          <div className="text-center">
            {recording ? (
              <>
                {mode === "audio" && (
                  <p className="font-mono text-xl tabular-nums text-coral">{mmss(elapsed)}</p>
                )}
                <p className="text-xs text-sand/50">Tocca di nuovo per fermare</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-sand/80">
                  {mode === "foto" ? "Tocca per scattare" : "Tocca per registrare"}
                </p>
                {mode === "audio" && (
                  <button
                    type="button"
                    onClick={toggleLevelCheck}
                    disabled={checkingLevel}
                    className="mt-1.5 text-xs font-medium text-sky underline-offset-4 hover:underline disabled:opacity-50"
                  >
                    {liveStream ? "Chiudi microfono" : "Controlla livello prima di registrare"}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Selettore modo: frecce + dot + etichette */}
        {!fullscreen && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => cycleMode(-1)}
              className="p-1 text-sand/40 transition hover:text-sand"
              aria-label="Modalità precedente"
            >
              <ChevronLeftIcon />
            </button>
            <div className="flex items-end gap-4">
              {MODES.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => !recording && (setMode(m), setError(null))}
                  className={`flex flex-col items-center gap-1 transition ${
                    i === modeIdx ? "text-sand" : "text-sand/35 hover:text-sand/60"
                  }`}
                >
                  <span
                    className={`rounded-full transition-all ${
                      i === modeIdx ? "h-2 w-2 bg-sand" : "h-1.5 w-1.5 bg-sand/30"
                    }`}
                  />
                  <span className="text-[10px] font-medium">{MODE_LABEL[m]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => cycleMode(1)}
              className="p-1 text-sand/40 transition hover:text-sand"
              aria-label="Modalità successiva"
            >
              <ChevronRightIcon />
            </button>
          </div>
        )}

        {error && (mode === "audio" || cameraReady) && (
          <p className="text-center text-sm text-coral px-4">{error}</p>
        )}
      </div>
    </>
  );
}

/* ─── Indicatore di livello ─── */

// Scala in dB: -60 dB → 0%, 0 dB (fondo scala) → 100%
const DB_FLOOR = -60;
const pct = (db: number) => Math.max(0, Math.min(1, (db - DB_FLOOR) / -DB_FLOOR)) * 100;

function LevelMeter({ stream }: { stream: MediaStream }) {
  const maskRef = useRef<HTMLDivElement>(null);
  const [clip, setClip] = useState(false);

  useEffect(() => {
    if (!stream.getAudioTracks().length) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    src.connect(an); // niente collegamento alle casse: solo analisi
    const buf = new Float32Array(an.fftSize);
    let raf = 0;
    let level = 0;
    let clipUntil = 0;
    let clipShown = false;

    // iOS può creare il contesto "sospeso": riprendilo al primo tocco
    const resume = () => ctx.state === "suspended" && ctx.resume().catch(() => {});
    resume();
    document.addEventListener("pointerdown", resume);

    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
      }
      const target = pct(20 * Math.log10(Math.max(peak, 1e-6)));
      // salita immediata, discesa morbida (come un VU meter)
      level = target > level ? target : level * 0.93 + target * 0.07;
      if (maskRef.current) maskRef.current.style.width = `${100 - level}%`;
      const now = performance.now();
      if (peak >= 0.99) clipUntil = now + 1500;
      const c = now < clipUntil;
      if (c !== clipShown) {
        clipShown = c;
        setClip(c);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", resume);
      src.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="w-full max-w-[260px]">
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full"
        style={{
          background: `linear-gradient(to right, #7ED93A 0%, #7ED93A ${pct(-18)}%, #FFD000 ${pct(-18)}%, #FFD000 ${pct(-3)}%, #FF4757 ${pct(-3)}%)`,
        }}
        role="meter"
        aria-label="Livello microfono"
      >
        {/* maschera scura che copre la parte non raggiunta dal segnale */}
        <div ref={maskRef} className="absolute inset-y-0 right-0 bg-dark-bg/90" style={{ width: "100%" }} />
      </div>
      <p className={`mt-1 text-center text-[11px] ${clip ? "font-semibold text-coral" : "text-sand/40"}`}>
        {clip ? "Satura! Allontana il telefono dalle casse" : "Ideale: picchi nel giallo, mai nel rosso"}
      </p>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="white" stroke="white" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" fill="white" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" fill="white" />
    </svg>
  );
}
function ChevronLeftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function FlipCameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 7h-3a2 2 0 0 0-1.6.8L13 10H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1" />
      <path d="M15 2l5 5-5 5" />
      <circle cx="11" cy="15" r="2" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="10" y1="14" x2="3" y2="21" />
      <line x1="21" y1="3" x2="14" y2="10" />
    </svg>
  );
}
