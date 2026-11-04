"use client";

import { useState } from "react";
import { MEMBERS, MOODS, moodById, type ProvaMeta } from "@/lib/band";
import { saveMeta } from "@/lib/library";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function MetaCard({
  folderId,
  initial,
  pinProtected,
}: {
  folderId: string;
  initial: ProvaMeta;
  pinProtected: boolean;
}) {
  const [meta, setMeta] = useState<ProvaMeta>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProvaMeta>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pin, setPin] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem("afdsa-pin") || "" : "",
  );

  function startEdit() {
    setDraft(meta);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (pinProtected) localStorage.setItem("afdsa-pin", pin);
      const saved = await saveMeta(folderId, draft, pin);
      setMeta(saved);
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore");
    } finally {
      setSaving(false);
    }
  }

  const toggleIn = (key: "present" | "beers", m: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(m) ? d[key].filter((x) => x !== m) : [...d[key], m],
    }));

  if (!editing) {
    const mood = moodById(meta.mood);
    return (
      <div className="card flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Info prova</h2>
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-dark-border px-3 py-1.5 text-sm font-medium text-sand/80 transition active:scale-95"
          >
            Modifica
          </button>
        </div>
        {savedFlash && <p className="text-sm font-medium text-lime">Salvato ✓</p>}

        <Row label="Presenti">
          {meta.present.length ? (
            meta.present.map((m) => (
              <span key={m} className="badge bg-lime/15 text-lime">
                {cap(m)}
              </span>
            ))
          ) : (
            <Empty />
          )}
        </Row>
        <Row label="Ha pagato">
          {meta.paidRehearsal.who ? (
            <span className="badge bg-solar/15 text-solar">
              💸 {cap(meta.paidRehearsal.who)}
              {meta.paidRehearsal.amount != null ? ` · ${meta.paidRehearsal.amount}€` : ""}
            </span>
          ) : (
            <Empty />
          )}
        </Row>
        <Row label="Birre">
          {meta.beers.length ? (
            meta.beers.map((m) => (
              <span key={m} className="badge bg-tangerine/15 text-tangerine">
                🍺 {cap(m)}
              </span>
            ))
          ) : (
            <Empty />
          )}
        </Row>
        <Row label="Mood">
          {mood ? (
            <span className="badge bg-violet/15 text-violet">
              {mood.emoji} {mood.label}
            </span>
          ) : (
            <Empty />
          )}
        </Row>
        {meta.notes && (
          <Row label="Note">
            <span className="whitespace-pre-wrap text-sm text-sand/80">{meta.notes}</span>
          </Row>
        )}
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <h2 className="font-display text-lg font-semibold">Modifica info prova</h2>

      <Field label="Chi era presente">
        <Chips selected={draft.present} onToggle={(m) => toggleIn("present", m)} />
      </Field>

      <Field label="Chi ha pagato la sala">
        <Chips
          selected={draft.paidRehearsal.who ? [draft.paidRehearsal.who] : []}
          onToggle={(m) =>
            setDraft((d) => ({
              ...d,
              paidRehearsal: { ...d.paidRehearsal, who: d.paidRehearsal.who === m ? null : m },
            }))
          }
        />
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-sand/60">Importo</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            value={draft.paidRehearsal.amount ?? ""}
            placeholder="0"
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                paidRehearsal: {
                  ...d.paidRehearsal,
                  amount: e.target.value === "" ? null : Number(e.target.value),
                },
              }))
            }
            className="field w-24"
          />
          <span className="text-sm text-sand/60">€</span>
        </div>
      </Field>

      <Field label="Chi ha comprato le birre">
        <Chips selected={draft.beers} onToggle={(m) => toggleIn("beers", m)} />
      </Field>

      <Field label="Mood generale">
        <div className="flex flex-wrap gap-2">
          {MOODS.map((mo) => {
            const on = draft.mood === mo.id;
            return (
              <button
                key={mo.id}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, mood: on ? null : mo.id }))}
                className={`chip ${on ? "chip-on" : "chip-off"}`}
              >
                <span>{mo.emoji}</span> {mo.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Altre note">
        <textarea
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          rows={3}
          maxLength={2000}
          placeholder="es. provata 'Rosa', batteria un po' indietro…"
          className="field resize-y"
        />
      </Field>

      {pinProtected && (
        <Field label="Codice di accesso">
          <input
            type="text"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="field"
          />
        </Field>
      )}

      {error && <p className="text-sm text-coral">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="flex-1 rounded-xl border border-dark-border py-3 font-medium text-sand/80 transition active:scale-95 disabled:opacity-50"
        >
          Annulla
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-xl bg-gradient-to-r from-flamingo to-tangerine py-3 font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {saving ? "Salvataggio…" : "Salva"}
        </button>
      </div>
    </div>
  );
}

/* ---------- sotto-componenti ---------- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-24 shrink-0 pt-1 text-xs font-medium uppercase tracking-wide text-sand/40">
        {label}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label">{label}</p>
      {children}
    </div>
  );
}

function Empty() {
  return <span className="text-sm text-sand/30">—</span>;
}

function Chips({ selected, onToggle }: { selected: string[]; onToggle: (m: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {MEMBERS.map((m) => {
        const on = selected.includes(m);
        return (
          <button
            key={m}
            type="button"
            onClick={() => onToggle(m)}
            className={`chip ${on ? "chip-on" : "chip-off"}`}
          >
            {cap(m)}
          </button>
        );
      })}
    </div>
  );
}
