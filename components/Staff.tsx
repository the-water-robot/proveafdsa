"use client";

import { useEffect, useRef } from "react";
import { staffPos, midiName } from "@/lib/music";
import type { MelodyNote } from "@/lib/notes";

const H = 5; // mezzo spazio (distanza riga-spazio)
const CLEF_W = 30;

/** Pentagramma in chiave di violino, disegnato in SVG. Battute da 4/4 automatiche. */
export default function Staff({
  notes,
  flats = false,
  active = -1,
  selected = -1,
  onSelect,
  autoScroll,
}: {
  notes: MelodyNote[];
  flats?: boolean;
  active?: number;
  selected?: number;
  onSelect?: (i: number) => void;
  autoScroll?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pos = notes.map((n) => (n.p === null ? null : staffPos(n.p, flats)));
  const steps = pos.filter(Boolean).map((p) => p!.step);
  const minStep = Math.min(-4, ...steps.map((s) => s - 3));
  const maxStep = Math.max(12, ...steps.map((s) => s + 8));
  const yOf = (step: number) => (maxStep - step) * H + 4;
  const height = (maxStep - minStep) * H + 22;

  // x di ogni nota + stanghette ogni 4 battiti
  const xs: number[] = [];
  const bars: number[] = [];
  let x = CLEF_W + 8;
  let beat = 0;
  notes.forEach((n) => {
    xs.push(x);
    x += 20 + Math.min(4, n.d) * 7 + (pos[xs.length - 1]?.acc ? 6 : 0);
    beat += n.d;
    if (beat >= 4 - 1e-6) {
      beat = beat % 4;
      bars.push(x - 6);
      x += 4;
    }
  });
  const width = Math.max(x + 16, 240);

  useEffect(() => {
    if (autoScroll && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [notes.length, autoScroll]);

  return (
    <div ref={scroller} className="overflow-x-auto rounded-xl bg-sand/[0.04]" style={{ scrollbarWidth: "none" }}>
      <svg width={width} height={height} className="block" role="img" aria-label={`Melodia: ${notes.map((n) => (n.p === null ? "pausa" : midiName(n.p, flats))).join(" ")}`}>
        {[0, 2, 4, 6, 8].map((s) => (
          <line key={s} x1={4} x2={width - 4} y1={yOf(s)} y2={yOf(s)} stroke="rgba(255,251,242,0.28)" strokeWidth={1} />
        ))}
        <text x={6} y={yOf(2) + 13} fontSize={44} fill="rgba(255,251,242,0.55)" style={{ fontFamily: "serif" }}>
          𝄞
        </text>
        {bars.map((bx, i) => (
          <line key={`b${i}`} x1={bx} x2={bx} y1={yOf(8)} y2={yOf(0)} stroke="rgba(255,251,242,0.35)" strokeWidth={1} />
        ))}
        {notes.map((n, i) => {
          const cx = xs[i];
          const color = i === active ? "#29C5EE" : i === selected ? "#FF5F8F" : "#FFFBF2";
          const hit = (
            <rect
              x={cx - 10}
              y={0}
              width={22}
              height={height}
              fill="transparent"
              onClick={onSelect ? () => onSelect(i) : undefined}
              style={onSelect ? { cursor: "pointer" } : undefined}
            />
          );
          const dotted = [0.75, 1.5, 3].includes(n.d);
          if (n.p === null) {
            const y = yOf(4);
            return (
              <g key={i}>
                {n.d >= 2 ? (
                  <rect x={cx - 5} y={n.d >= 4 ? y - 5 : y - 1} width={10} height={4} fill={color} />
                ) : (
                  <path
                    d={`M${cx - 2} ${y - 9} l5 5 l-5 4 l5 5 ${n.d < 1 ? "m-6 -3 l4 0" : ""}`}
                    stroke={color}
                    strokeWidth={2}
                    fill="none"
                    strokeLinecap="round"
                  />
                )}
                {dotted && <circle cx={cx + 9} cy={y - 3} r={1.6} fill={color} />}
                {hit}
              </g>
            );
          }
          const { step, acc } = pos[i]!;
          const y = yOf(step);
          const filled = n.d < 2;
          const up = step < 4;
          const ledgers: number[] = [];
          for (let s = -2; s >= step; s -= 2) ledgers.push(s);
          for (let s = 10; s <= step; s += 2) ledgers.push(s);
          const stemX = up ? cx + 5 : cx - 5;
          const stemEnd = up ? y - 30 : y + 30;
          return (
            <g key={i}>
              {ledgers.map((s) => (
                <line key={s} x1={cx - 9} x2={cx + 9} y1={yOf(s)} y2={yOf(s)} stroke="rgba(255,251,242,0.5)" strokeWidth={1} />
              ))}
              {acc && (
                <text x={cx - 17} y={y + 4} fontSize={13} fill={color}>
                  {acc}
                </text>
              )}
              <ellipse
                cx={cx}
                cy={y}
                rx={5.6}
                ry={4}
                transform={`rotate(-20 ${cx} ${y})`}
                fill={filled ? color : "none"}
                stroke={color}
                strokeWidth={filled ? 0 : 1.6}
              />
              {n.d < 4 && <line x1={stemX} x2={stemX} y1={y} y2={stemEnd} stroke={color} strokeWidth={1.3} />}
              {n.d <= 0.75 && (
                <path
                  d={up ? `M${stemX} ${stemEnd} q2 8 8 12` : `M${stemX} ${stemEnd} q2 -8 8 -12`}
                  stroke={color}
                  strokeWidth={1.6}
                  fill="none"
                />
              )}
              {n.d <= 0.25 && (
                <path
                  d={up ? `M${stemX} ${stemEnd + 6} q2 8 8 12` : `M${stemX} ${stemEnd - 6} q2 -8 8 -12`}
                  stroke={color}
                  strokeWidth={1.6}
                  fill="none"
                />
              )}
              {dotted && <circle cx={cx + 9} cy={step % 2 === 0 ? y - 3 : y} r={1.6} fill={color} />}
              <text x={cx} y={height - 4} fontSize={9} textAnchor="middle" fill="rgba(255,251,242,0.45)">
                {midiName(n.p, flats)}
              </text>
              {hit}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Iconcina della figura (croma, semiminima…) per i pulsanti delle durate. */
export function NoteIcon({ d }: { d: number }) {
  const filled = d < 2;
  return (
    <svg width={16} height={22} viewBox="0 0 16 22" aria-hidden>
      <ellipse cx={6} cy={17} rx={4.6} ry={3.3} transform="rotate(-20 6 17)" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 0 : 1.5} />
      {d < 4 && <line x1={10.2} x2={10.2} y1={16} y2={2} stroke="currentColor" strokeWidth={1.4} />}
      {d <= 0.75 && <path d="M10.2 2 q2 6 5 8" stroke="currentColor" strokeWidth={1.5} fill="none" />}
    </svg>
  );
}
