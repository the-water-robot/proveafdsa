"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFolders, fetchMeta, type DriveFolder } from "@/lib/library";
import { moodById, type ProvaMeta } from "@/lib/band";
import { prettyFolderDate } from "@/lib/format";

export default function ProveList() {
  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metas, setMetas] = useState<Record<string, ProvaMeta>>({});

  useEffect(() => {
    let cancelled = false;
    fetchFolders()
      .then(async (fs) => {
        if (cancelled) return;
        setFolders(fs);
        // riassunti metadati (mood + presenti): max 4 richieste alla volta, dalla più recente,
        // per non saturare le quote di Drive quando le prove diventano tante
        const queue = [...fs];
        const worker = async () => {
          for (let f = queue.shift(); f && !cancelled; f = queue.shift()) {
            const id = f.id;
            try {
              const m = await fetchMeta(id);
              if (!cancelled) setMetas((prev) => ({ ...prev, [id]: m }));
            } catch {
              /* ignora: resta "…" */
            }
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Errore"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="pb-tabbar mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pt-safe">
      <header className="flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" width={40} height={40} className="rounded-xl" />
        <div>
          <h1 className="font-display text-2xl font-bold leading-tight">Prove</h1>
          <p className="text-sm text-sand/60">Ascolta e annota le prove</p>
        </div>
      </header>

      {error && (
        <p className="card border-coral/40 bg-coral/10 p-4 text-sm text-coral">{error}</p>
      )}
      {folders === null && !error && (
        <ul className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="card h-[76px] animate-pulse" />
          ))}
        </ul>
      )}
      {folders && folders.length === 0 && (
        <p className="card p-5 text-sm text-sand/60">
          Ancora nessuna prova. Vai su <b>Carica</b> per iniziare.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {folders?.map((f) => {
          const m = metas[f.id];
          const mood = m ? moodById(m.mood) : null;
          return (
            <li key={f.id}>
              <Link
                href={`/prove/${f.id}?d=${encodeURIComponent(f.name)}`}
                className="card flex items-center gap-3 p-4 transition active:scale-[0.99]"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet/30 to-sky/20 text-lg">
                  {mood ? mood.emoji : "🎶"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-semibold first-letter:uppercase">
                    {prettyFolderDate(f.name)}
                  </p>
                  <p className="text-xs text-sand/50">
                    {m
                      ? m.present.length
                        ? `${m.present.length} presenti`
                        : "presenze non segnate"
                      : "…"}
                    {mood ? ` · ${mood.label}` : ""}
                  </p>
                </div>
                <ChevronGlyph />
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function ChevronGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sand/30">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
