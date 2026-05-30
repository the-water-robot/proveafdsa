"use client";

import { useEffect, useRef, useState } from "react";

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignora */
    }
  }
  return "";
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Recorder({ onRecorded }: { onRecorded: (blob: Blob) => void }) {
  const [supported, setSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSupported(
      typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    );
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanup() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        cleanup();
        setRecording(false);
        setElapsed(0);
        if (blob.size > 0) onRecorded(blob);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch {
      setError("Microfono non disponibile o permesso negato.");
      cleanup();
    }
  }

  function stop() {
    try {
      recRef.current?.stop();
    } catch {
      cleanup();
      setRecording(false);
    }
  }

  if (!supported) {
    return (
      <p className="text-sm text-sand/60">
        La registrazione non è supportata su questo browser. Usa “Scegli file”.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={recording ? stop : start}
        className="relative flex h-28 w-28 items-center justify-center rounded-full transition active:scale-95"
        aria-label={recording ? "Ferma registrazione" : "Avvia registrazione"}
      >
        {recording && (
          <span className="absolute inset-0 rounded-full bg-coral/40 animate-pulse-ring" />
        )}
        <span
          className={`relative flex h-28 w-28 items-center justify-center rounded-full shadow-lg ${
            recording
              ? "bg-coral"
              : "bg-gradient-to-br from-flamingo to-tangerine"
          }`}
        >
          {recording ? (
            <span className="h-8 w-8 rounded-md bg-white" />
          ) : (
            <MicIcon />
          )}
        </span>
      </button>

      <div className="text-center">
        {recording ? (
          <p className="font-mono text-xl tabular-nums text-coral">{mmss(elapsed)}</p>
        ) : (
          <p className="text-sm font-medium text-sand/80">Tocca per registrare</p>
        )}
        {recording && <p className="text-xs text-sand/50">Tocca di nuovo per fermare</p>}
      </div>

      {error && <p className="text-sm text-coral">{error}</p>}
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
