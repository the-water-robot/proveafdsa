"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AudioPlayer from "@/components/AudioPlayer";
import { fetchBest, type AudioFile } from "@/lib/library";
import { BEST_MIN } from "@/lib/ratings";

// "Il meglio": le tracce con media voti ≥ BEST_MIN di tutte le prove, dalla più votata.
export default function Meglio() {
  const [tracks, setTracks] = useState<AudioFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBest()
      .then(setTracks)
      .catch((e) => setError(e instanceof Error ? e.message : "Errore"));
  }, []);

  return (
    <main className="pb-tabbar mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pt-safe">
      <header className="flex items-center gap-3">
        <Link href="/prove" className="rounded-full p-1 text-sand/60 transition hover:text-sand" aria-label="Indietro">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight">⭐ Il meglio</h1>
          <p className="text-sm text-sand/60">
            Le take da riascoltare: media da {BEST_MIN} stelle in su
          </p>
        </div>
      </header>

      {error && <p className="card border-coral/40 bg-coral/10 p-4 text-sm text-coral">{error}</p>}
      {tracks === null && !error && (
        <ul className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="card h-[96px] animate-pulse" />
          ))}
        </ul>
      )}
      {tracks && tracks.length === 0 && (
        <div className="card p-5 text-sm text-sand/60">
          <p>Ancora nessuna take da {BEST_MIN}+ stelle 🤷</p>
          <p className="mt-2">
            Apri una prova e vota le registrazioni con le stelline: ognuno dà il suo voto, qui finiscono quelle che
            convincono la band.
          </p>
        </div>
      )}
      {tracks && tracks.length > 0 && <AudioPlayer tracks={tracks} initialSortBest />}
    </main>
  );
}
