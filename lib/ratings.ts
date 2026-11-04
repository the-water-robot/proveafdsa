// Voti a stelle delle registrazioni — isomorfo (client + server).
// Ogni membro dà il SUO voto 1..5; sono salvati sul file Drive come appProperties
// ("rating_pit" = "4"): niente conflitti se si vota in contemporanea, e il voto
// resta attaccato alla traccia anche se la si rinomina o sposta.
import { MEMBERS, isMember } from "./band";

export type Ratings = Record<string, number>; // membro → 1..5

/** Da qui in su (media) una traccia "vale la pena riascoltarla". */
export const BEST_MIN = 4;

export const ratingKey = (who: string) => `rating_${who.toLowerCase()}`;

export function ratingsFromProps(props?: Record<string, string> | null): Ratings {
  const out: Ratings = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    const m = /^rating_(.+)$/.exec(k);
    const n = Number(v);
    if (m && isMember(m[1]) && n >= 1 && n <= 5) out[m[1]] = Math.round(n);
  }
  return out;
}

export function average(r?: Ratings): number | null {
  const v = Object.values(r ?? {});
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function isBest(r?: Ratings): boolean {
  const a = average(r);
  return a !== null && a >= BEST_MIN;
}

/** "4,3" */
export function formatAvg(a: number): string {
  return a.toFixed(1).replace(".", ",").replace(",0", "");
}

/** Voti in ordine di formazione (pit, dave, …). */
export function sortedVotes(r?: Ratings): [string, number][] {
  return MEMBERS.filter((m) => r?.[m]).map((m) => [m, r![m]]);
}
