"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchFolders, fetchSummaries, type DriveFolder, type FolderSummary } from "@/lib/library";
import { moodById } from "@/lib/band";
import { prettyFolderDate } from "@/lib/format";

// Cache locale (stale-while-revalidate): riaprendo "Prove" si vede subito tutto, poi si aggiorna.
const LS_FOLDERS = "afdsa-folders";
const LS_SUMMARY = "afdsa-summaries";
// gruppi progressivi: le prove più recenti (in cima) arrivano prima, poi gruppi più grandi
const BATCH_SIZES = [2, 4, 6];

function readLS<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota piena: pazienza */
  }
}

export default function ProveList() {
  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sums, setSums] = useState<Record<string, FolderSummary>>({});
  const [fresh, setFresh] = useState<Set<string>>(new Set()); // riepiloghi già aggiornati in questa visita

  useEffect(() => {
    let cancelled = false;
    // 1) subito quello che c'era l'ultima volta
    const cachedFolders = readLS<DriveFolder[] | null>(LS_FOLDERS, null);
    const cachedSums = readLS<Record<string, FolderSummary>>(LS_SUMMARY, {});
    if (cachedFolders?.length) setFolders(cachedFolders);
    setSums(cachedSums);

    // 2) lista aggiornata, poi riepiloghi a gruppi dalla prova più recente alla più vecchia
    fetchFolders()
      .then(async (fs) => {
        if (cancelled) return;
        setFolders(fs);
        writeLS(LS_FOLDERS, fs);
        const all: Record<string, FolderSummary> = { ...cachedSums };
        const batches: string[][] = [];
        for (let i = 0, k = 0; i < fs.length; k++) {
          const n = BATCH_SIZES[Math.min(k, BATCH_SIZES.length - 1)];
          batches.push(fs.slice(i, i + n).map((f) => f.id));
          i += n;
        }
        const worker = async () => {
          for (let b = batches.shift(); b && !cancelled; b = batches.shift()) {
            try {
              const res = await fetchSummaries(b);
              if (cancelled) return;
              for (const s of res) all[s.id] = s;
              writeLS(LS_SUMMARY, all); // salva subito: vale anche se si esce a metà
              setSums((prev) => {
                const next = { ...prev };
                for (const s of res) next[s.id] = s;
                return next;
              });
              setFresh((prev) => new Set([...prev, ...b]));
            } catch {
              /* resta il dato in cache */
            }
          }
        };
        // 3 gruppi in parallelo: i primi (più recenti) arrivano per primi
        await Promise.all([worker(), worker(), worker()]);
        if (!cancelled) {
          // in cache solo le prove che esistono ancora
          const keep: Record<string, FolderSummary> = {};
          for (const f of fs) if (all[f.id]) keep[f.id] = all[f.id];
          writeLS(LS_SUMMARY, keep);
        }
      })
      .catch((e) => !cancelled && !readLS(LS_FOLDERS, null) && setError(e instanceof Error ? e.message : "Errore"));
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
          <p className="text-sm text-sand/60">
            {folders ? `${folders.length} prove · ascolta e annota` : "Ascolta e annota le prove"}
          </p>
        </div>
      </header>

      {error && <p className="card border-coral/40 bg-coral/10 p-4 text-sm text-coral">{error}</p>}
      {folders === null && !error && (
        <ul className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="card h-[84px] animate-pulse" />
          ))}
        </ul>
      )}
      {folders && folders.length === 0 && (
        <p className="card p-5 text-sm text-sand/60">
          Ancora nessuna prova. Vai su <b>Carica</b> per iniziare.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {folders?.map((f) => (
          <FolderCard key={f.id} folder={f} sum={sums[f.id]} updating={!fresh.has(f.id)} />
        ))}
      </ul>
    </main>
  );
}

function FolderCard({ folder, sum, updating }: { folder: DriveFolder; sum?: FolderSummary; updating: boolean }) {
  const m = sum?.meta;
  const mood = m ? moodById(m.mood) : null;
  const info = [
    mood ? mood.label : null,
    m ? (m.present.length ? `${m.present.length} presenti` : null) : null,
  ].filter(Boolean);
  const empty = sum && !sum.audio && !sum.photos && !sum.videos;

  return (
    <li>
      <Link
        href={`/prove/${folder.id}?d=${encodeURIComponent(folder.name)}`}
        className="card flex items-center gap-3 p-4 transition active:scale-[0.99]"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet/30 to-sky/20 text-lg">
          {mood ? mood.emoji : "🎶"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold first-letter:uppercase">{prettyFolderDate(folder.name)}</p>
          {sum ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-sand/60">
              {empty ? (
                <span className="text-sand/40">vuota</span>
              ) : (
                <>
                  <Count n={sum.audio} icon="🎵" label="audio" />
                  <Count n={sum.photos} icon="📸" label="foto" />
                  <Count n={sum.videos} icon="🎬" label="video" />
                </>
              )}
              {info.length > 0 && <span className="truncate text-sand/40">{info.join(" · ")}</span>}
            </div>
          ) : (
            <span className="mt-1 block h-3 w-32 animate-pulse rounded bg-sand/10" aria-label="Carico…" />
          )}
        </div>
        {updating && sum ? (
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky/60" aria-label="Aggiornamento…" />
        ) : (
          <ChevronGlyph />
        )}
      </Link>
    </li>
  );
}

function Count({ n, icon, label }: { n: number; icon: string; label: string }) {
  if (!n) return null;
  return (
    <span className="whitespace-nowrap tabular-nums" aria-label={`${n} ${label}`}>
      <span aria-hidden>{icon}</span> {n}
    </span>
  );
}

function ChevronGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sand/30">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
