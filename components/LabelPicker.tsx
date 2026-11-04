"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSongs } from "@/lib/songs";
import { QUICK_LABELS, normalize, rankSuggestions, type LabelSuggestion } from "@/lib/recording";

/** Foglio dal basso per scegliere "che pezzo è": repertorio, canzoniere, etichette al volo o testo libero. */
export default function LabelPicker({
  title,
  current,
  onPick,
  onClose,
  laterLabel,
}: {
  title: string;
  current: string;
  laterLabel?: string; // testo del pulsante "lo faccio dopo"
  onPick: (label: string) => void;
  onClose: () => void;
}) {
  const songs = useSongs();
  const [q, setQ] = useState("");
  const { ranked, canzoniere, extra, recentCount: rc } = useMemo(() => rankSuggestions(songs), [songs]);
  const recentCount = Math.min(8, rc);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function pick(label: string) {
    onPick(label.trim());
    onClose();
  }

  const query = q.trim();
  const nq = normalize(query);
  const filtered = nq
    ? [...ranked, ...QUICK_LABELS.map((x) => ({ title: x.label, emoji: x.emoji }))].filter((s) =>
        normalize(s.title).includes(nq),
      )
    : [];
  const exactHit = filtered.some((s) => normalize(s.title) === nq);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="mx-auto flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-dark-border bg-dark-card shadow-2xl"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="rounded-full p-2 text-sand/50">
            <XIcon />
          </button>
        </div>

        <div className="px-5 pb-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query) pick(filtered.length === 1 ? filtered[0].title : query);
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="✏️ Cerca o scrivi un titolo…"
              enterKeyHint="done"
              autoCapitalize="sentences"
              className="field"
            />
          </form>
        </div>

        {laterLabel && !q && (
          <div className="px-5 pb-3">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl border border-dark-border py-2.5 text-sm font-medium text-sand/60"
            >
              {laterLabel}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          {query ? (
            <div className="flex flex-col gap-3">
              {!exactHit && (
                <button
                  type="button"
                  onClick={() => pick(query)}
                  className="w-full rounded-xl bg-gradient-to-r from-flamingo to-tangerine px-4 py-3 text-left text-sm font-semibold text-white"
                >
                  Usa «{query}» ✨
                </button>
              )}
              {filtered.length > 0 ? (
                <Chips items={filtered} current={current} onPick={pick} />
              ) : (
                <p className="text-sm text-sand/40">Mai sentito… pezzo nuovo? 👀</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {recentCount > 0 && (
                <Section label="Suonati di recente 🔥">
                  <Chips items={ranked.slice(0, recentCount)} current={current} onPick={pick} />
                </Section>
              )}
              <Section label="Dal canzoniere 📖">
                <Chips items={canzoniere} current={current} onPick={pick} />
              </Section>
              {extra.length > 0 && (
                <Section label="Titoli di lavoro 🧪">
                  <Chips items={extra.slice(0, 12)} current={current} onPick={pick} />
                </Section>
              )}
              <Section label="Al volo ⚡">
                <Chips
                  items={QUICK_LABELS.map((x) => ({ title: x.label, emoji: x.emoji }))}
                  current={current}
                  onPick={pick}
                />
              </Section>
              {current && (
                <button
                  type="button"
                  onClick={() => pick("")}
                  className="self-start text-sm text-sand/40 underline-offset-4 hover:underline"
                >
                  Togli il nome
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-sand/40">{label}</p>
      {children}
    </div>
  );
}

function Chips({
  items,
  current,
  onPick,
}: {
  items: LabelSuggestion[];
  current: string;
  onPick: (t: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s) => {
        const on = normalize(s.title) === normalize(current);
        return (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.title)}
            className={`chip ${on ? "chip-on" : "chip-off"}`}
          >
            {s.emoji && <span aria-hidden>{s.emoji}</span>} {s.title}
          </button>
        );
      })}
    </div>
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
