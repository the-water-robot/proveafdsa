"use client";

import { useEffect, useRef, useState } from "react";
import NoteEditor, { ChordLine } from "./NoteEditor";
import Staff from "./Staff";
import { useWho } from "./Stars";
import { deleteNote, fetchNotes, saveNote } from "@/lib/library";
import { memberLabel } from "@/lib/band";
import { prefersFlats } from "@/lib/music";
import { findSong } from "@/lib/recording";
import { KINDS, newNote, type MusicNote, type NoteKind } from "@/lib/notes";
import { playSequence } from "@/lib/synth";
import { chordEvents, melodyEvents } from "./noteEvents";

/** Sezione "Appunti" nella pagina della prova: lista + aggiungi/modifica. */
export default function NotesSection({ folderId }: { folderId: string }) {
  const [notes, setNotes] = useState<MusicNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ note: MusicNote; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [who] = useWho();

  useEffect(() => {
    fetchNotes(folderId)
      .then(setNotes)
      .catch((e) => {
        setNotes([]);
        setError(e instanceof Error ? e.message : "Errore");
      });
  }, [folderId]);

  function open(kind: NoteKind) {
    setSaveError(null);
    setEditing({ note: newNote(kind, { who }), isNew: true });
  }

  async function save(n: MusicNote) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await saveNote({ folder: folderId }, n);
      setNotes(res.notes);
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    try {
      setNotes(await deleteNote(folderId, id));
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-semibold text-sand/70">
        Appunti {notes && notes.length > 0 && <span className="text-sand/40">· {notes.length}</span>}
      </h2>
      <AddNoteButtons onAdd={open} />
      {error && <p className="text-sm text-coral">{error}</p>}
      {notes === null ? (
        <p className="text-sm text-sand/50">Carico…</p>
      ) : (
        notes.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            onEdit={() => {
              setSaveError(null);
              setEditing({ note: n, isNew: false });
            }}
          />
        ))
      )}
      {editing && (
        <NoteEditor
          initial={editing.note}
          isNew={editing.isNew}
          saving={saving}
          error={saveError}
          onSave={save}
          onDelete={editing.isNew ? undefined : () => remove(editing.note.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

/** I tre pulsanti "+ Accordi / + Melodia / + Testo". */
export function AddNoteButtons({ onAdd }: { onAdd: (k: NoteKind) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {KINDS.map((k) => (
        <button
          key={k.id}
          type="button"
          onClick={() => onAdd(k.id)}
          className="flex flex-col items-center gap-0.5 rounded-2xl border border-dashed border-dark-border bg-dark-card/60 px-2 py-2.5 transition active:scale-[0.97]"
        >
          <span className="text-xl" aria-hidden>
            {k.emoji}
          </span>
          <span className="text-sm font-semibold">+ {k.label}</span>
          <span className="text-[10px] leading-tight text-sand/40">{k.hint}</span>
        </button>
      ))}
    </div>
  );
}

function NoteCard({ note, onEdit }: { note: MusicNote; onEdit: () => void }) {
  const [active, setActive] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const song = note.song ? findSong(note.song) : null;
  const kind = KINDS.find((k) => k.id === note.kind)!;
  const playable =
    (note.kind === "chords" && note.chords.some((c) => c !== "|" && !/^x\d/.test(c))) ||
    (note.kind === "melody" && note.melody.some((m) => m.p !== null));

  function play() {
    if (active >= 0) {
      stopRef.current?.();
      return;
    }
    const evs = note.kind === "chords" ? chordEvents(note.chords) : melodyEvents(note.melody);
    if (!evs.length) return;
    setActive(evs[0].token);
    stopRef.current = playSequence(
      evs,
      note.bpm,
      (i) => setActive(evs[i].token),
      () => setActive(-1),
    );
  }

  const when = new Date(note.created).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  return (
    <article className="card flex flex-col gap-2.5 p-4">
      <header className="flex items-start gap-2">
        <span className="text-lg leading-none" aria-hidden>
          {kind.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {note.song ? (
              <>
                {song?.emoji && <span aria-hidden>{song.emoji} </span>}
                {note.song}
              </>
            ) : (
              <span className="text-sand/60">{kind.label}</span>
            )}
            {note.section && (
              <span className="ml-1.5 rounded-full bg-violet/25 px-2 py-0.5 text-[11px] font-medium text-sand/80">{note.section}</span>
            )}
          </p>
          <p className="text-[11px] text-sand/40">
            {[note.who && memberLabel(note.who), `ore ${when}`, note.key && `in ${note.key}`, playable && `${note.bpm} bpm`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {playable && (
          <button
            type="button"
            onClick={play}
            aria-label={active >= 0 ? "Stop" : "Suona"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${
              active >= 0 ? "bg-sky text-ink" : "bg-sand/10 text-sand"
            }`}
          >
            {active >= 0 ? "■" : "▶"}
          </button>
        )}
        <button type="button" onClick={onEdit} className="rounded-full px-2 py-1.5 text-xs font-medium text-sky">
          Modifica
        </button>
      </header>

      {note.kind === "chords" && note.chords.length > 0 && (
        <ChordLine chords={note.chords} keyName={note.key} active={active} />
      )}
      {note.kind === "melody" && note.melody.length > 0 && (
        <Staff notes={note.melody} flats={prefersFlats(note.key)} active={active} />
      )}
      {note.text && (
        <p className={`whitespace-pre-wrap text-sm ${note.kind === "text" ? "text-sand/85" : "text-sand/60"}`}>{note.text}</p>
      )}
    </article>
  );
}
