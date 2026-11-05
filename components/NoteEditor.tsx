"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LabelPicker from "./LabelPicker";
import Staff, { NoteIcon } from "./Staff";
import { findSong } from "@/lib/recording";
import {
  CHORD_ROOTS,
  KEY_ROOTS,
  QUALITIES,
  degreeOf,
  diatonicChords,
  midiName,
  parseChord,
  prefersFlats,
  spell,
  transposeChord,
  transposeKey,
  DURATION_NAMES,
} from "@/lib/music";
import { KINDS, SECTIONS, isEmptyNote, type MelodyNote, type MusicNote, type NoteKind } from "@/lib/notes";
import { blip, playSequence, stopAll, strum } from "@/lib/synth";
import { chordEvents, melodyEvents } from "./noteEvents";

/**
 * Editor a tutto schermo per un appunto. `note` già esistente → modifica (con Elimina),
 * altrimenti nuovo (si può cambiare tipo con le linguette in alto).
 */
export default function NoteEditor({
  initial,
  isNew,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  initial: MusicNote;
  isNew: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: (n: MusicNote) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [n, setN] = useState<MusicNote>(() => {
    // tonalità del pezzo dal canzoniere, se c'è e non è già indicata
    const song = initial.song ? findSong(initial.song) : null;
    return !initial.key && song?.key ? { ...initial, key: song.key } : initial;
  });
  const [picker, setPicker] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const dirty = JSON.stringify(n) !== JSON.stringify(initial);
  const set = (patch: Partial<MusicNote>) => setN((x) => ({ ...x, ...patch }));

  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      stopAll();
    };
  }, []);

  function close() {
    if (dirty && !isEmptyNote(n) && !confirm("Chiudere senza salvare l'appunto?")) return;
    onClose();
  }

  if (!mounted) return null;
  const song = n.song ? findSong(n.song) : null;
  const canSave = !isEmptyNote(n) && !saving;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Appunto">
      <div
        className="mx-auto flex h-[94dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-dark-border bg-dark-card shadow-2xl"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {/* intestazione */}
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          {isNew ? (
            <div className="flex flex-1 gap-1 rounded-xl bg-dark-bg/70 p-1">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => set({ kind: k.id as NoteKind })}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-medium transition ${
                    n.kind === k.id ? "bg-sand text-ink" : "text-sand/60"
                  }`}
                >
                  <span aria-hidden>{k.emoji}</span> {k.label}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="flex-1 font-display text-lg font-semibold">
              {KINDS.find((k) => k.id === n.kind)?.emoji} {KINDS.find((k) => k.id === n.kind)?.label}
            </h2>
          )}
          <button type="button" onClick={close} aria-label="Chiudi" className="rounded-full p-2 text-sand/50">
            <XIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-3">
          {/* pezzo + sezione */}
          <div className="flex flex-wrap items-center gap-2 py-1">
            <button type="button" onClick={() => setPicker(true)} className={`chip ${n.song ? "chip-on" : "chip-off"}`}>
              <span aria-hidden>{song?.emoji ?? "🎵"}</span> {n.song || "Che pezzo? (opz.)"}
            </button>
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => set({ section: n.section === s ? "" : s })}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  n.section === s ? "bg-violet text-white" : "bg-sand/[0.06] text-sand/50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="mt-3">
            {n.kind === "chords" && <ChordInput note={n} set={set} />}
            {n.kind === "melody" && <MelodyInput note={n} set={set} />}
            <textarea
              value={n.text}
              onChange={(e) => set({ text: e.target.value })}
              placeholder={
                n.kind === "text"
                  ? "Scrivi qui: un'idea, un pezzo di testo, la struttura (Intro – Strofa ×2 – Rit…), cosa sistemare la prossima volta…"
                  : "Note (opz.): “il rit va più lento”, “capotasto al 2”…"
              }
              rows={n.kind === "text" ? 10 : 2}
              autoFocus={n.kind === "text" && isNew}
              className={`field mt-3 resize-none ${n.kind === "text" ? "min-h-[40dvh]" : ""}`}
            />
          </div>
        </div>

        {/* azioni */}
        <div className="flex flex-col gap-2 border-t border-dark-border px-4 pt-3">
          {error && <p className="text-sm text-coral">{error}</p>}
          <div className="flex items-center gap-2">
            {onDelete &&
              (confirmDel ? (
                <button type="button" onClick={onDelete} className="rounded-xl bg-coral/20 px-3 py-3 text-sm font-semibold text-coral">
                  Sicuro? Elimina
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmDel(true)} className="rounded-xl px-3 py-3 text-sm text-sand/40">
                  Elimina
                </button>
              ))}
            <button
              type="button"
              disabled={!canSave}
              onClick={() => onSave({ ...n, updated: Date.now() })}
              className="flex-1 rounded-xl bg-gradient-to-r from-flamingo to-tangerine px-4 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-40"
            >
              {saving ? "Salvo…" : isNew ? "Salva appunto ✨" : "Salva modifiche"}
            </button>
          </div>
        </div>
      </div>
      {picker && (
        <LabelPicker
          title="Di che pezzo è?"
          current={n.song}
          onPick={(label) => {
            const s = label ? findSong(label) : null;
            set({ song: label, ...(s?.key && !n.key ? { key: s.key } : {}) });
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>,
    document.body,
  );
}

/* ─────────────── Accordi ─────────────── */

function ChordInput({ note, set }: { note: MusicNote; set: (p: Partial<MusicNote>) => void }) {
  const chords = note.chords;
  const [sel, setSel] = useState<number | null>(null); // accordo selezionato (altrimenti si lavora sull'ultimo)
  const [slash, setSlash] = useState(false); // prossima tonica = basso
  const [keyOpen, setKeyOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [playing, setPlaying] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  const flats = prefersFlats(note.key);
  const diatonic = useMemo(() => diatonicChords(note.key), [note.key]);

  const lastChordIdx = (() => {
    for (let i = chords.length - 1; i >= 0; i--) if (parseChord(chords[i])) return i;
    return -1;
  })();
  const target = sel ?? lastChordIdx;

  function put(list: string[]) {
    set({ chords: list });
  }
  function add(sym: string) {
    strum(sym);
    if (sel !== null) {
      // inserisce dopo il selezionato
      const list = chords.slice();
      list.splice(sel + 1, 0, sym);
      put(list);
      setSel(sel + 1);
    } else put([...chords, sym]);
  }
  function tapRoot(root: string) {
    if (slash && target >= 0) {
      const c = parseChord(chords[target]);
      if (c) {
        const sym = spell(c.root, flats) + c.quality + "/" + root;
        replaceAt(target, sym);
      }
      setSlash(false);
      return;
    }
    add(root);
  }
  function replaceAt(i: number, sym: string) {
    const list = chords.slice();
    list[i] = sym;
    put(list);
    strum(sym);
  }
  function setQuality(q: string) {
    if (target < 0) return;
    const c = parseChord(chords[target]);
    if (!c) return;
    const raw = chords[target];
    const root = /^[A-G][#b]?/.exec(raw)![0];
    const bass = raw.includes("/") ? raw.slice(raw.indexOf("/")) : "";
    replaceAt(target, root + q + bass);
  }
  function backspace() {
    if (!chords.length) return;
    if (sel !== null) {
      put(chords.filter((_, i) => i !== sel));
      setSel(null);
    } else put(chords.slice(0, -1));
  }
  function transpose(d: number) {
    const newKey = note.key ? transposeKey(note.key, d) : "";
    const f = newKey ? prefersFlats(newKey) : flats;
    set({ chords: chords.map((c) => (parseChord(c) ? transposeChord(c, d, f) : c)), key: newKey });
  }
  function play() {
    if (playing >= 0) {
      stopRef.current?.();
      return;
    }
    const evs = chordEvents(chords);
    if (!evs.length) return;
    setPlaying(evs[0].token);
    stopRef.current = playSequence(
      evs,
      note.bpm,
      (i) => setPlaying(evs[i].token),
      () => setPlaying(-1),
    );
  }

  const curQuality = target >= 0 ? parseChord(chords[target])?.quality ?? null : null;

  return (
    <div className="flex flex-col gap-3">
      {/* il giro */}
      <div className="min-h-[76px] rounded-2xl border border-dark-border bg-dark-bg/60 p-3">
        {chords.length === 0 ? (
          <p className="py-3 text-center text-sm text-sand/40">Tocca gli accordi qui sotto per scrivere il giro 👇</p>
        ) : (
          <ChordLine
            chords={chords}
            keyName={note.key}
            active={playing}
            selected={sel}
            onTap={(i) => {
              setSel(sel === i ? null : i);
              if (parseChord(chords[i])) strum(chords[i]);
            }}
          />
        )}
      </div>

      {/* comandi */}
      <div className="flex flex-wrap items-center gap-1.5">
        <SmallBtn onClick={play} on={playing >= 0} disabled={!chords.some((c) => parseChord(c))}>
          {playing >= 0 ? "■ Stop" : "▶ Suona"}
        </SmallBtn>
        <SmallBtn onClick={() => add("|")} label="Stanghetta di battuta">|</SmallBtn>
        <SmallBtn onClick={() => add("x2")}>×2</SmallBtn>
        <SmallBtn onClick={backspace} disabled={!chords.length} label="Cancella">
          ⌫
        </SmallBtn>
        <span className="flex-1" />
        <SmallBtn onClick={() => transpose(-1)} disabled={!chords.length} label="Trasporta giù di mezzo tono">
          −½
        </SmallBtn>
        <SmallBtn onClick={() => transpose(1)} disabled={!chords.length} label="Trasporta su di mezzo tono">
          +½
        </SmallBtn>
      </div>

      {/* tonalità */}
      <div>
        <button type="button" onClick={() => setKeyOpen((v) => !v)} className="text-sm text-sand/60">
          Tonalità: <b className="text-sand">{note.key || "—"}</b> <span className="text-sand/30">{keyOpen ? "▴" : "▾"}</span>
          {!note.key && <span className="text-xs text-sand/40"> · sceglila per avere gli accordi giusti a portata</span>}
        </button>
        {keyOpen && (
          <KeyPicker
            value={note.key}
            onPick={(k) => {
              set({ key: k });
              setKeyOpen(false);
            }}
          />
        )}
      </div>

      {diatonic.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-sand/40">In {note.key}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {diatonic.map((c, i) => (
              <button
                key={`${c}${i}`}
                type="button"
                onClick={() => add(c)}
                className="flex flex-col items-center rounded-xl bg-violet/15 py-2 font-semibold text-sand transition active:scale-95 active:bg-violet/40"
              >
                <span className="text-base leading-tight">{c}</span>
                <span className="text-[10px] font-normal text-sand/45">{degreeOf(c, note.key)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-sand/40">
          {slash ? "Scegli il basso…" : "Tutti gli accordi"}
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          {CHORD_ROOTS.map((r, pc) => {
            const shown = note.key ? spell(pc, flats) : r; // senza tonalità: C# ed Eb, i più comuni
            return (
              <button
                key={r}
                type="button"
                onClick={() => tapRoot(shown)}
                className={`rounded-xl py-2.5 text-sm font-semibold transition active:scale-95 ${
                  slash ? "bg-sky/20 text-sky" : "bg-sand/[0.07] text-sand active:bg-sand/20"
                }`}
              >
                {shown}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUALITIES.map((q) => (
            <button
              key={q.s}
              type="button"
              disabled={target < 0}
              onClick={() => setQuality(q.s)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-30 ${
                curQuality === q.s ? "bg-flamingo text-white" : "bg-sand/[0.07] text-sand/70"
              }`}
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            disabled={target < 0}
            onClick={() => setSlash((v) => !v)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-30 ${
              slash ? "bg-sky text-ink" : "bg-sand/[0.07] text-sand/70"
            }`}
          >
            /basso
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-sand/35">
          Tocca una nota per aggiungere l&apos;accordo, poi m, 7, sus4… lo trasformano.
          {sel !== null ? " Stai modificando l'accordo selezionato (rosa)." : ""}
        </p>
      </div>

      {/* tastiera vera, per chi va più veloce scrivendo */}
      <div>
        {typing ? (
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={() => {
              const toks = typed
                .replace(/[,;]/g, " ")
                .split(/\s+/)
                .map((t) => t.replace(/^([a-g])/, (m) => m.toUpperCase()).replace(/×/g, "x"))
                .filter((t) => t === "|" || /^x\d{1,2}$/.test(t) || parseChord(t));
              put(toks);
              setTyping(false);
            }}
            placeholder="G D Em C | Am C D"
            className="field font-mono"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setTyped(chords.join(" "));
              setTyping(true);
            }}
            className="text-xs text-sky underline-offset-4 hover:underline"
          >
            ⌨️ Preferisci scriverli? (es. G D Em C)
          </button>
        )}
      </div>

      <Bpm value={note.bpm} onChange={(bpm) => set({ bpm })} />
    </div>
  );
}

/** Il giro come chip, con stanghette e gradi (se c'è la tonalità). */
export function ChordLine({
  chords,
  keyName,
  active = -1,
  selected = null,
  onTap,
}: {
  chords: string[];
  keyName: string;
  active?: number;
  selected?: number | null;
  onTap?: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-x-1 gap-y-2">
      {chords.map((c, i) => {
        if (c === "|") return <span key={i} className="mx-0.5 self-stretch border-l-2 border-sand/25" aria-label="battuta" />;
        if (/^x\d/.test(c))
          return (
            <span key={i} className="px-1 pb-3 text-sm font-bold text-solar">
              ×{c.slice(1)}
            </span>
          );
        const deg = keyName ? degreeOf(c, keyName) : null;
        const on = i === active;
        const isSel = i === selected;
        const Tag = onTap ? "button" : "span";
        return (
          <Tag
            key={i}
            {...(onTap ? { type: "button" as const, onClick: () => onTap(i) } : {})}
            className={`flex min-w-[2.6rem] flex-col items-center rounded-lg px-1.5 py-1 transition ${
              on ? "bg-sky text-ink" : isSel ? "bg-flamingo/30 ring-1 ring-flamingo" : "bg-sand/[0.06]"
            }`}
          >
            <span className="font-display text-base font-bold leading-tight">{c}</span>
            {deg && <span className={`text-[10px] ${on ? "text-ink/70" : "text-sand/40"}`}>{deg}</span>}
          </Tag>
        );
      })}
    </div>
  );
}

function KeyPicker({ value, onPick }: { value: string; onPick: (k: string) => void }) {
  const [minor, setMinor] = useState(value.endsWith("m"));
  return (
    <div className="mt-2 rounded-xl bg-dark-bg/60 p-2">
      <div className="mb-2 flex gap-1">
        {[false, true].map((m) => (
          <button
            key={String(m)}
            type="button"
            onClick={() => setMinor(m)}
            className={`flex-1 rounded-lg py-1 text-xs font-semibold ${minor === m ? "bg-sand text-ink" : "text-sand/50"}`}
          >
            {m ? "minore" : "maggiore"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {KEY_ROOTS.map((r) => {
          const k = r + (minor ? "m" : "");
          return (
            <button
              key={r}
              type="button"
              onClick={() => onPick(k)}
              className={`rounded-lg py-1.5 text-xs font-semibold ${value === k ? "bg-flamingo text-white" : "bg-sand/[0.07]"}`}
            >
              {k}
            </button>
          );
        })}
        <button type="button" onClick={() => onPick("")} className="rounded-lg py-1.5 text-xs text-sand/40">
          nessuna
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Melodia ─────────────── */

function MelodyInput({ note, set }: { note: MusicNote; set: (p: Partial<MusicNote>) => void }) {
  const mel = note.melody;
  const [dur, setDur] = useState(1);
  const [dotted, setDotted] = useState(false);
  const [octave, setOctave] = useState(4); // C4 = Do centrale
  const [sel, setSel] = useState<number | null>(null);
  const [playing, setPlaying] = useState(-1);
  const stopRef = useRef<(() => void) | null>(null);
  const flats = prefersFlats(note.key);
  const d = dotted && dur < 4 ? dur * 1.5 : dur;

  function push(p: number | null) {
    if (p !== null) blip(p);
    const item: MelodyNote = { p, d };
    if (sel !== null) {
      // con una nota selezionata, il tasto la sostituisce
      const list = mel.slice();
      list[sel] = { p, d: list[sel].d };
      set({ melody: list });
      setSel(sel + 1 < list.length ? sel + 1 : null);
    } else set({ melody: [...mel, item] });
  }
  function setDuration(v: number, dot = dotted) {
    setDur(v);
    if (sel !== null) {
      const list = mel.slice();
      list[sel] = { ...list[sel], d: dot && v < 4 ? v * 1.5 : v };
      set({ melody: list });
    }
  }
  function backspace() {
    if (sel !== null) {
      set({ melody: mel.filter((_, i) => i !== sel) });
      setSel(null);
    } else set({ melody: mel.slice(0, -1) });
  }
  function shift(semi: number) {
    if (!mel.some((x) => x.p !== null)) return;
    set({ melody: mel.map((x) => (x.p === null ? x : { ...x, p: Math.min(108, Math.max(21, x.p + semi)) })) });
  }
  function play() {
    if (playing >= 0) {
      stopRef.current?.();
      return;
    }
    const evs = melodyEvents(mel);
    if (!evs.length) return;
    stopRef.current = playSequence(
      evs.map((e) => e),
      note.bpm,
      (i) => setPlaying(evs[i].token),
      () => setPlaying(-1),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {mel.length === 0 ? (
        <div className="rounded-xl bg-sand/[0.04] px-3 py-6 text-center text-sm text-sand/40">
          Suona sulla tastiera: ogni tasto aggiunge una nota 🎹
        </div>
      ) : (
        <Staff
          notes={mel}
          flats={flats}
          active={playing}
          selected={sel ?? -1}
          onSelect={(i) => {
            setSel(sel === i ? null : i);
            const p = mel[i].p;
            if (p !== null) blip(p);
          }}
          autoScroll={sel === null}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <SmallBtn onClick={play} on={playing >= 0} disabled={!mel.some((x) => x.p !== null)}>
          {playing >= 0 ? "■ Stop" : "▶ Suona"}
        </SmallBtn>
        <SmallBtn onClick={() => push(null)}>pausa</SmallBtn>
        <SmallBtn onClick={backspace} disabled={!mel.length} label="Cancella">
          ⌫
        </SmallBtn>
        <span className="flex-1" />
        <SmallBtn onClick={() => shift(-12)} disabled={!mel.length} label="Tutta un'ottava sotto">
          8va↓
        </SmallBtn>
        <SmallBtn onClick={() => shift(12)} disabled={!mel.length} label="Tutta un'ottava sopra">
          8va↑
        </SmallBtn>
      </div>

      {/* durate */}
      <div className="flex items-center gap-1.5">
        {[0.5, 1, 2, 4].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setDuration(v)}
            aria-label={DURATION_NAMES[v]}
            title={DURATION_NAMES[v]}
            className={`flex h-10 flex-1 items-center justify-center rounded-xl transition ${
              dur === v ? "bg-sand text-ink" : "bg-sand/[0.07] text-sand/70"
            }`}
          >
            <NoteIcon d={v} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setDotted(!dotted);
            setDuration(dur, !dotted);
          }}
          aria-label="Puntata"
          aria-pressed={dotted}
          className={`h-10 w-12 rounded-xl text-xl font-bold transition ${dotted ? "bg-sand text-ink" : "bg-sand/[0.07] text-sand/70"}`}
        >
          ·
        </button>
      </div>
      <p className="-mt-1.5 text-[11px] text-sand/35">
        {DURATION_NAMES[d]}
        {sel !== null ? " · nota selezionata: il prossimo tasto la sostituisce" : ""}
      </p>

      <Keyboard octave={octave} setOctave={setOctave} flats={flats} onKey={push} />
      <Bpm value={note.bpm} onChange={(bpm) => set({ bpm })} />
    </div>
  );
}

/** Tastiera di un'ottava (+ il Do sopra), spostabile. Suona al tocco, senza ritardi. */
function Keyboard({
  octave,
  setOctave,
  flats,
  onKey,
}: {
  octave: number;
  setOctave: (o: number) => void;
  flats: boolean;
  onKey: (midi: number) => void;
}) {
  const base = (octave + 1) * 12; // C dell'ottava
  const whites = [0, 2, 4, 5, 7, 9, 11, 12];
  const blacks: [number, number][] = [
    [1, 0],
    [3, 1],
    [6, 3],
    [8, 4],
    [10, 5],
  ]; // [semitono, dopo il tasto bianco n°]
  const [down, setDown] = useState<number | null>(null);
  const press = (m: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    setDown(m);
    onKey(m);
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-sand/50">
        <button type="button" onClick={() => setOctave(Math.max(2, octave - 1))} className="rounded-lg bg-sand/[0.07] px-3 py-1.5 font-semibold" disabled={octave <= 2}>
          ‹ più grave
        </button>
        <span>
          ottava {octave}
          {octave === 4 ? " · Do centrale" : ""}
        </span>
        <button type="button" onClick={() => setOctave(Math.min(6, octave + 1))} className="rounded-lg bg-sand/[0.07] px-3 py-1.5 font-semibold" disabled={octave >= 6}>
          più acuto ›
        </button>
      </div>
      <div className="relative h-36 touch-none select-none" onPointerUp={() => setDown(null)} onPointerLeave={() => setDown(null)}>
        <div className="flex h-full gap-[3px]">
          {whites.map((s) => {
            const m = base + s;
            return (
              <button
                key={s}
                type="button"
                onPointerDown={press(m)}
                aria-label={midiName(m, flats, true)}
                className={`flex flex-1 items-end justify-center rounded-b-lg pb-1.5 text-[11px] font-semibold transition-colors ${
                  down === m ? "bg-sky text-ink" : "bg-sand text-ink/50"
                }`}
              >
                {midiName(m, flats)}
                {s % 12 === 0 && <sub className="text-[8px]">{Math.floor(m / 12) - 1}</sub>}
              </button>
            );
          })}
        </div>
        {blacks.map(([s, after]) => {
          const m = base + s;
          const left = ((after + 1) / whites.length) * 100;
          return (
            <button
              key={s}
              type="button"
              onPointerDown={press(m)}
              aria-label={midiName(m, flats, true)}
              style={{ left: `calc(${left}% - 5.5%)`, width: "9%" }}
              className={`absolute top-0 h-[58%] rounded-b-md text-[9px] font-semibold transition-colors ${
                down === m ? "bg-sky text-ink" : "bg-ink text-sand/50"
              }`}
            >
              <span className="absolute bottom-1 left-0 right-0 text-center">{midiName(m, flats)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── comuni ─────────────── */

function Bpm({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm text-sand/60">
      <span>Tempo</span>
      <button type="button" onClick={() => onChange(Math.max(40, value - 5))} className="rounded-lg bg-sand/[0.07] px-3 py-1 font-semibold">
        −
      </button>
      <span className="w-16 text-center tabular-nums text-sand">{value} bpm</span>
      <button type="button" onClick={() => onChange(Math.min(240, value + 5))} className="rounded-lg bg-sand/[0.07] px-3 py-1 font-semibold">
        +
      </button>
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  disabled,
  on,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  on?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition active:scale-95 disabled:opacity-30 ${
        on ? "bg-sky text-ink" : "bg-sand/[0.08] text-sand/80"
      }`}
    >
      {children}
    </button>
  );
}

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
