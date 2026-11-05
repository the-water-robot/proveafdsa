"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import AudioPlayer from "@/components/AudioPlayer";
import MediaGrid from "@/components/MediaGrid";
import MetaCard from "@/components/MetaCard";
import NotesSection from "@/components/NotesSection";
import { fetchFiles, fetchMedia, fetchMeta, type AudioFile, type MediaFile } from "@/lib/library";
import { defaultMeta, type ProvaMeta } from "@/lib/band";
import { prettyFolderDate } from "@/lib/format";

export default function Page() {
  return (
    <Suspense fallback={<main className="px-4 pt-safe text-sm text-sand/50">Carico…</main>}>
      <ProvaDetail />
    </Suspense>
  );
}

function ProvaDetail() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = params.id;
  const name = search.get("d") || "Prova";

  const [files, setFiles] = useState<AudioFile[] | null>(null);
  const [media, setMedia] = useState<MediaFile[] | null>(null);
  const [meta, setMeta] = useState<ProvaMeta | null>(null);
  const [pinProtected, setPinProtected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchFiles(id)
      .then(setFiles)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Errore");
        setFiles([]);
      });
    fetchMeta(id)
      .then(setMeta)
      .catch(() => setMeta(defaultMeta()));
    fetchMedia(id)
      .then(setMedia)
      .catch(() => setMedia([]));
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setPinProtected(!!h.pinProtected))
      .catch(() => {});
  }, [id]);

  return (
    <main className="pb-tabbar mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 px-4 pt-safe">
      <header className="flex items-center gap-3">
        <Link href="/prove" className="rounded-full p-1 text-sand/60 transition hover:text-sand" aria-label="Indietro">
          <BackGlyph />
        </Link>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold leading-tight first-letter:uppercase">
            {prettyFolderDate(name)}
          </h1>
          <p className="text-sm text-sand/60">Animali Fantastici del Sud America</p>
        </div>
      </header>

      {error && (
        <p className="card border-coral/40 bg-coral/10 p-4 text-sm text-coral">{error}</p>
      )}

      {meta && <MetaCard folderId={id} initial={meta} pinProtected={pinProtected} />}

      {id && <NotesSection folderId={id} />}

      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold text-sand/70">Registrazioni</h2>
        {files === null ? (
          <p className="text-sm text-sand/50">Carico…</p>
        ) : (
          <AudioPlayer tracks={files} folderName={name} />
        )}
      </section>

      {media && media.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-sm font-semibold text-sand/70">Foto & Video</h2>
          <MediaGrid files={media} />
        </section>
      )}
    </main>
  );
}

function BackGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
