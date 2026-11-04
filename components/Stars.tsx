"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { INSTRUMENT, MEMBERS, memberLabel } from "@/lib/band";
import { average, formatAvg, sortedVotes, type Ratings } from "@/lib/ratings";
import { getServerSnapshot, getSnapshot, setWho, subscribe } from "@/lib/queue";

/** Chi sono io (stesso valore di "Chi sei" nella pagina Carica). */
export function useWho(): [string, (w: string) => void] {
  const { who } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (!who) {
      try {
        const saved = localStorage.getItem("afdsa-who");
        if (saved) setWho(saved);
      } catch {
        /* ignora */
      }
    }
  }, [who]);
  return [who.toLowerCase(), setWho];
}

/**
 * 5 stelle: mostrano il MIO voto (tocca per votare, ritocca la stessa per toglierlo)
 * + media della band e numero di voti (tocca per vedere chi ha dato cosa).
 */
export function StarRating({
  ratings,
  me,
  onRate,
  busy,
  compact,
}: {
  ratings?: Ratings;
  me: string;
  onRate: (stars: number) => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [details, setDetails] = useState(false);
  const mine = (me && ratings?.[me]) || 0;
  const avg = average(ratings);
  const votes = sortedVotes(ratings);
  const size = compact ? 18 : 20;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={`flex items-center ${busy ? "opacity-60" : ""}`} role="radiogroup" aria-label="Il tuo voto">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={mine === n}
              aria-label={`${n} stell${n === 1 ? "a" : "e"}`}
              onClick={() => onRate(mine === n ? 0 : n)}
              className="p-0.5 transition active:scale-90"
            >
              <StarGlyph size={size} filled={n <= mine} />
            </button>
          ))}
        </div>
        {avg !== null ? (
          <button
            type="button"
            onClick={() => setDetails((v) => !v)}
            className="text-xs tabular-nums text-sand/60"
            aria-expanded={details}
          >
            <span className="font-semibold text-solar">★ {formatAvg(avg)}</span>
            <span className="text-sand/40"> · {votes.length} vot{votes.length === 1 ? "o" : "i"}</span>
          </button>
        ) : (
          !compact && <span className="text-xs text-sand/30">da votare</span>
        )}
      </div>
      {details && votes.length > 0 && (
        <p className="text-[11px] text-sand/50">
          {votes.map(([m, v]) => `${memberLabel(m)} ${v}★`).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** Foglio "Chi sei?" quando si prova a votare senza averlo ancora detto. */
export function WhoPicker({ onPick, onClose }: { onPick: (who: string) => void; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Chi sei?"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="mx-auto w-full max-w-md rounded-t-3xl border-t border-dark-border bg-dark-card p-5 shadow-2xl"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
      >
        <h2 className="font-display text-lg font-semibold">Chi sei? 🎶</h2>
        <p className="mt-1 text-sm text-sand/50">Ognuno dà il suo voto: serve saperlo una volta sola.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {MEMBERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onPick(m)}
              className="chip chip-off !px-4 !py-2 text-base"
            >
              <span aria-hidden>{INSTRUMENT[m].emoji}</span> {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StarGlyph({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.13l-5.62 2.97 1.07-6.27L2.9 9.4l6.3-.9L12 2.8z"
        fill={filled ? "#FFD000" : "none"}
        stroke={filled ? "#FFD000" : "rgba(255,251,242,0.3)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
