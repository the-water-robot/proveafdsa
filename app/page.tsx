"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Recorder from "@/components/Recorder";
import LabelPicker from "@/components/LabelPicker";
import { INSTRUMENT, MEMBERS, memberLabel } from "@/lib/band";
import { extFromMime, formatBytes, prettyFolderDate, splitNameExt, todayIso } from "@/lib/format";
import { findSong, rankSuggestions, titleFromFileName } from "@/lib/recording";
import { ACCEPT } from "@/lib/mime";
import { useSongs } from "@/lib/songs";
import {
  addBlob,
  clearDone,
  dismissRestored,
  getServerSnapshot,
  getSnapshot,
  removeItem,
  restoreQueue,
  retryItem,
  setAutoUpload,
  setDate,
  setItemLabel,
  setNextLabel,
  setPin,
  setWho,
  subscribe,
  uploadAll,
  type QueueItem,
  type Status,
} from "@/lib/queue";

const SHARE_CACHE = "afdsa-shared";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Un po' di simpatia, ma stabile per ogni file (niente frasi che cambiano a ogni render)
const MYSTERY = ["Che pezzo era? 🤔", "Pezzo misterioso 🕵️", "Senza nome, per ora 🎶", "Dagli un nome ✨"];
const CHEERS = ["Al sicuro su Drive 🔒", "Caricato! 🤘", "In cassaforte 💾", "Fatto, bravi ✨", "Salvato 🎉"];
function pickFor(id: string, list: string[]) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return list[Math.abs(h) % list.length];
}

export default function Home() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { items, uploading, recording, date, lastFolder, restoredCount, who, pin, autoUpload, nextLabel } = s;
  const [pinProtected, setPinProtected] = useState(false);
  const [configMissing, setConfigMissing] = useState<string[] | null>(null);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  // picker aperto: per un file della coda, oppure per la prossima registrazione
  const [picker, setPicker] = useState<{ itemId: string; justRecorded?: boolean } | { next: true } | null>(null);

  const songs = useSongs();
  const quick = rankSuggestions(songs).ranked.slice(0, 4);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preferenze + stato server + coda salvata + eventuali file condivisi (share target)
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setPinProtected(Boolean(h.pinProtected));
        if (!h.ok) setConfigMissing(h.missing || []);
      })
      .catch(() => {});

    const ua = navigator.userAgent;
    setPlatform(
      /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
        ? "ios"
        : /Android/.test(ua)
          ? "android"
          : "other",
    );

    restoreQueue();
    importSharedFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waiting = items.filter((i) => i.status === "ready" || i.status === "error");
  const errors = waiting.filter((i) => i.status === "error").length;
  const doneCount = items.filter((i) => i.status === "done").length;

  // Avviso prima di chiudere/ricaricare mentre si registra o si carica
  useEffect(() => {
    if (!recording && !uploading) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [recording, uploading]);

  const onRecorded = useCallback((blob: Blob) => {
    const type = blob.type || "";
    const base = type.startsWith("video/") ? "video" : type.startsWith("image/") ? "foto" : "prova";
    const item = addBlob(blob, base, extFromMime(type || "audio/webm"));
    // appena fermata una registrazione senza nome: chiedi subito che pezzo era (un tocco e via)
    if (!item.label && !type.startsWith("image/")) setPicker({ itemId: item.id, justRecorded: true });
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((f) => {
      const { base, ext } = splitNameExt(f.name);
      const title = titleFromFileName(base);
      // "Hermano.m4a" → pezzo "Hermano" (senza ripetere il nome nel file); nomi automatici restano com'erano
      addBlob(f, title ? "" : base || "file", ext || extFromMime(f.type), title || undefined);
    });
  }, []);

  async function importSharedFiles() {
    try {
      if (!("caches" in window)) return;
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      const collected: File[] = [];
      for (const req of keys) {
        const res = await cache.match(req);
        if (!res) continue;
        const blob = await res.blob();
        const name = decodeURIComponent(res.headers.get("x-filename") || "condiviso");
        collected.push(new File([blob], name, { type: blob.type }));
        await cache.delete(req);
      }
      if (collected.length) addFiles(collected);
    } catch {
      /* ignora */
    } finally {
      if (location.search) history.replaceState(null, "", location.pathname);
    }
  }

  const isToday = date === todayIso();
  const folderName = date.replace(/-/g, " ");
  const pickerItem = picker && "itemId" in picker ? items.find((i) => i.id === picker.itemId) : null;
  const nextSong = nextLabel ? findSong(nextLabel) : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-safe">
      <header className="flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" width={48} height={48} className="rounded-xl" />
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold leading-tight">Prove</h1>
          <p className="text-sm text-sand/60">Animali Fantastici del Sud America</p>
        </div>
        <span className="text-xs text-sand/30 font-mono">v18</span>
      </header>

      {configMissing && configMissing.length > 0 && (
        <div className="card border-coral/50 bg-coral/10 p-4 text-sm">
          <p className="font-semibold text-coral">Configurazione server incompleta</p>
          <p className="mt-1 text-sand/70">
            Mancano le variabili: {configMissing.join(", ")}. Imposta le env su Vercel (vedi README).
          </p>
        </div>
      )}

      {restoredCount > 0 && (
        <div className="card flex items-start gap-3 border-solar/40 bg-solar/10 p-4 text-sm">
          <p className="flex-1 text-sand/80">
            <b className="text-solar">
              {restoredCount === 1 ? "1 file recuperato" : `${restoredCount} file recuperati`}
            </b>{" "}
            dall&apos;ultima volta, non ancora caricati. Controlla la data e premi Carica.
          </p>
          <button type="button" onClick={dismissRestored} className="text-sand/40" aria-label="Chiudi avviso">
            <CloseIcon />
          </button>
        </div>
      )}

      {/* Dettagli prova */}
      <section className="card flex flex-col gap-4 p-5">
        <div>
          <label className="label" htmlFor="date">
            Data della prova
          </label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            disabled={uploading}
            className="field"
          />
          <p className="mt-1 text-xs text-sand/50">
            {date && (
              <>
                {!isToday && <span className="font-semibold text-solar">Non è oggi · </span>}
                {prettyFolderDate(folderName)} → cartella <span className="font-mono">{folderName}</span>
              </>
            )}
          </p>
        </div>
        <div>
          <p className="label">
            Chi sei <span className="text-sand/40">(opz.)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {MEMBERS.map((m) => {
              const on = who.toLowerCase() === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWho(on ? "" : m)}
                  aria-pressed={on}
                  title={INSTRUMENT[m].label}
                  className={`chip ${on ? "chip-on" : "chip-off"}`}
                >
                  <span aria-hidden>{INSTRUMENT[m].emoji}</span> {cap(m)}
                </button>
              );
            })}
          </div>
        </div>
        {pinProtected && (
          <div>
            <label className="label" htmlFor="pin">
              Codice di accesso
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="codice della band"
              className="field"
            />
          </div>
        )}
      </section>

      {/* Registra / aggiungi */}
      <section className="card flex flex-col items-center gap-5 p-6">
        <Recorder onRecorded={onRecorded} />

        {/* Pezzo scelto PRIMA (facoltativo): vale per la prossima registrazione */}
        <div className="flex w-full flex-wrap items-center justify-center gap-2 text-sm">
          {nextLabel ? (
            <>
              <span className="text-sand/50">{recording ? "Sta registrando:" : "Prossimo pezzo:"}</span>
              <button
                type="button"
                onClick={() => setPicker({ next: true })}
                className="chip chip-on"
              >
                <span aria-hidden>{nextSong?.emoji ?? "🎵"}</span> {nextLabel}
              </button>
              <button
                type="button"
                onClick={() => setNextLabel("")}
                aria-label="Togli il pezzo"
                className="rounded-full p-1 text-sand/40"
              >
                <CloseIcon />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPicker({ next: true })}
              className="text-sky underline-offset-4 hover:underline"
            >
              {recording ? "🎵 Cosa state suonando?" : "🎵 Sai già cosa suonate? (opz.)"}
            </button>
          )}
        </div>

        <div className="flex w-full items-center gap-3 text-xs text-sand/40">
          <span className="h-px flex-1 bg-dark-border" />
          oppure
          <span className="h-px flex-1 bg-dark-border" />
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dark-border bg-dark-bg/60 px-4 py-3 font-medium text-sand transition active:scale-[0.98]"
        >
          <PaperclipIcon /> Scegli file
        </button>
        <ImportHelp platform={platform} />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      {/* Coda */}
      {items.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="whitespace-nowrap text-sm font-semibold text-sand/70">Registrazioni</h2>
            <div className="flex items-center gap-3 whitespace-nowrap">
              {doneCount > 0 && (
                <button type="button" onClick={clearDone} className="text-xs text-sand/40 hover:text-sand/70">
                  Pulisci
                </button>
              )}
              <Toggle checked={autoUpload} onChange={setAutoUpload} label="⚡ Carica da solo" />
            </div>
          </div>
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              who={who}
              uploading={uploading}
              quick={quick}
              onOpenPicker={() => setPicker({ itemId: item.id })}
            />
          ))}
        </section>
      )}

      {lastFolder && (
        <div className="flex flex-col items-center gap-2">
          <Link
            href={`/prove/${lastFolder.id}?d=${encodeURIComponent(lastFolder.name)}`}
            className="w-full rounded-xl border border-sky/40 bg-sky/10 px-4 py-3 text-center text-sm font-semibold text-sky transition active:scale-[0.99]"
          >
            ▸ Ascolta / info di questa prova
          </Link>
          {lastFolder.link && (
            <a
              href={lastFolder.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-sand/60 underline-offset-4 hover:underline"
            >
              Apri la cartella su Google Drive ↗
            </a>
          )}
        </div>
      )}

      {/* Barra azione fissa: solo se c'è qualcosa da caricare a mano o da riprovare */}
      {waiting.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-dark-border bg-dark-bg/90 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md">
            <button
              type="button"
              onClick={() => uploadAll()}
              disabled={uploading}
              className="w-full rounded-xl bg-gradient-to-r from-flamingo to-tangerine px-4 py-3.5 text-base font-semibold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-60"
            >
              {uploading
                ? "Caricamento in corso…"
                : errors === waiting.length
                  ? `Riprova ${errors} file`
                  : `Carica ${waiting.length} file su Drive`}
            </button>
          </div>
        </div>
      )}

      {picker && (
        <LabelPicker
          title={
            "next" in picker
              ? recording
                ? "Cosa state suonando? 🎶"
                : "Cosa state per suonare? 🎶"
              : picker.justRecorded
                ? pickFor(picker.itemId, ["Registrata ✓ Che pezzo era? 🎶", "Presa! Che pezzo era? 🤘", "Fatto ✓ Come la chiamiamo? 🎶"])
                : pickFor(picker.itemId, ["Che pezzo era? 🎶", "Com'è che si chiama? 🎶", "Che pezzo era? 🤘"])
          }
          current={"next" in picker ? nextLabel : (pickerItem?.label ?? "")}
          onPick={(l) => ("next" in picker ? setNextLabel(l) : setItemLabel(picker.itemId, l))}
          onClose={() => setPicker(null)}
          laterLabel={"itemId" in picker && picker.justRecorded ? "Più tardi 👋 (resta in coda senza nome)" : undefined}
        />
      )}
    </main>
  );
}

/* ---------- riga della coda ---------- */

function QueueRow({
  item,
  who,
  uploading,
  quick,
  onOpenPicker,
}: {
  item: QueueItem;
  who: string;
  uploading: boolean;
  quick: { title: string; emoji?: string }[];
  onOpenPicker: () => void;
}) {
  const song = item.label ? findSong(item.label) : null;
  const kind = item.subfolder === "video" ? "🎬" : item.subfolder === "foto" ? "📸" : null;
  const status =
    item.status === "uploading"
      ? `${Math.round(item.progress * 100)}%`
      : item.status === "done"
        ? item.renaming
          ? "rinomino su Drive…"
          : pickFor(item.id, CHEERS)
        : item.status === "ready"
          ? "in attesa"
          : null;

  return (
    <div className={`card flex flex-col gap-2 p-3 ${!item.label && item.status !== "error" ? "border-sky/30" : ""}`}>
      <div className="flex items-center gap-3">
        <StatusDot status={item.status} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenPicker}
            className="flex max-w-full items-center gap-1.5 text-left"
            aria-label={item.label ? `Pezzo: ${item.label}. Cambia` : "Dai un nome al pezzo"}
          >
            {item.label ? (
              <span className="truncate text-[15px] font-semibold">
                {kind ?? song?.emoji ?? "🎵"} {item.label}
              </span>
            ) : (
              <span className="truncate text-[15px] font-semibold text-sky">
                {kind ? `${kind} ` : ""}
                {pickFor(item.id, MYSTERY)}
              </span>
            )}
            <PencilIcon />
          </button>
          <p className="truncate text-xs text-sand/50">
            {[`ore ${item.time.slice(0, 5).replace(".", ":")}`, who && memberLabel(who), formatBytes(item.size), status]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {item.error && <p className="mt-0.5 text-xs text-coral">{item.error}</p>}
        </div>
        {item.status === "error" && !uploading && (
          <button
            type="button"
            onClick={() => retryItem(item.id)}
            className="shrink-0 rounded-lg bg-coral/15 px-2.5 py-1.5 text-xs font-semibold text-coral"
          >
            Riprova
          </button>
        )}
        {item.status === "done" && item.error && !item.renaming && (
          <button
            type="button"
            onClick={() => retryItem(item.id)}
            className="shrink-0 rounded-lg bg-coral/15 px-2.5 py-1.5 text-xs font-semibold text-coral"
          >
            Riprova
          </button>
        )}
        {(item.status === "ready" || item.status === "error") && !uploading && (
          <button
            type="button"
            onClick={() => removeItem(item.id)}
            className="shrink-0 rounded-full p-1.5 text-sand/40 transition hover:text-coral"
            aria-label="Rimuovi"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {item.status === "uploading" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-dark-bg">
          <div
            className="h-full rounded-full bg-sky transition-all"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </div>
      )}

      {/* Nome in un tocco: i pezzi più probabili + "altro" */}
      {!item.label && item.subfolder !== "foto" && (
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button
              key={q.title}
              type="button"
              onClick={() => setItemLabel(item.id, q.title)}
              className="chip chip-off !px-2.5 !py-1 text-xs"
            >
              {q.emoji && <span aria-hidden>{q.emoji}</span>} {q.title}
            </button>
          ))}
          <button type="button" onClick={onOpenPicker} className="chip chip-off !px-2.5 !py-1 text-xs text-sky">
            Altro…
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- aiuto: caricare dai Memo Vocali (iPhone) / dal registratore (Android) ---------- */

function ImportHelp({ platform }: { platform: "ios" | "android" | "other" }) {
  if (platform === "other") return null;
  return (
    <details className="w-full rounded-xl border border-dark-border bg-dark-bg/40 px-4 py-3 text-sm text-sand/70">
      <summary className="cursor-pointer select-none font-medium text-sand/80">
        {platform === "ios" ? "🎙️ Caricare dai Memo Vocali" : "🎙️ Caricare dal registratore del telefono"}
      </summary>
      {platform === "ios" ? (
        <div className="mt-3 flex flex-col gap-3">
          <a
            href="/carica-prove-afdsa.shortcut"
            className="block rounded-xl bg-gradient-to-r from-violet to-sky px-4 py-3 text-center font-semibold text-white"
          >
            📲 Aggiungi il Comando rapido
          </a>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
            <li>
              Tocca il pulsante qui sopra → <b>Aggiungi comando rapido</b> (una volta sola).
            </li>
            <li>
              Nei <b>Memo Vocali</b>: tocca il memo → <b>⋯</b> → <b>Condividi</b> →{" "}
              <b>Carica su Prove AFdSA</b>.
            </li>
            <li>
              La prima volta iPhone chiede il permesso di collegarsi: <b>Consenti sempre</b>. Finisce nella prova di
              oggi, col nome del memo come titolo del pezzo 🎶
            </li>
          </ol>
          <p className="text-[12px] text-sand/40">
            In alternativa: nei Memo ⋯ → <b>Salva in File</b>, poi qui <b>Scegli file → Sfoglia</b>.
          </p>
        </div>
      ) : (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
          <li>
            Installa l&apos;app: menu del browser <b>⋮</b> → <b>Aggiungi a schermata Home</b> (una volta sola).
          </li>
          <li>
            Nel registratore (o in File/WhatsApp): tocca la registrazione → <b>Condividi</b> → <b>Prove AFdSA</b>.
          </li>
          <li>Si apre qui con il file in coda: dagli un nome e parte da solo ⚡</li>
        </ol>
      )}
    </details>
  );
}

/* ---------- piccoli componenti di supporto ---------- */

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-sand/60">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-sky" : "bg-dark-border"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
        />
      </button>
    </label>
  );
}

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === "done"
      ? "bg-lime"
      : status === "error"
        ? "bg-coral"
        : status === "uploading"
          ? "bg-sky animate-pulse"
          : "bg-sand/30";
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls}`} />;
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sand/30">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
