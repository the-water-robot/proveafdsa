// Suggerimenti di etichetta lato CLIENT: repertorio dalle prove recenti (+ cache locale,
// così in sala prove con rete scarsa compaiono subito).
import { useEffect, useState } from "react";

export interface SongSuggestion {
  title: string;
  count: number;
  last: string;
}

const LS_KEY = "afdsa-songs";
let memory: SongSuggestion[] | null = null;
let inflight: Promise<SongSuggestion[]> | null = null;
const listeners = new Set<(s: SongSuggestion[]) => void>();

function readLocal(): SongSuggestion[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function refreshSongs(): Promise<SongSuggestion[]> {
  if (inflight) return inflight;
  inflight = fetch("/api/songs")
    .then((r) => r.json())
    .then((j: { songs?: SongSuggestion[] }) => {
      const songs = Array.isArray(j.songs) ? j.songs : [];
      if (songs.length) {
        memory = songs;
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(songs));
        } catch {
          /* ignora */
        }
        listeners.forEach((l) => l(songs));
      }
      return memory ?? songs;
    })
    .catch(() => memory ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Aggiunge al volo un titolo appena usato (prima che il server lo veda). */
export function rememberSong(title: string) {
  const t = title.trim();
  if (!t) return;
  const list = memory ?? readLocal();
  const rest = list.filter((s) => s.title.toLowerCase() !== t.toLowerCase());
  const prev = list.find((s) => s.title.toLowerCase() === t.toLowerCase());
  memory = [{ title: t, count: (prev?.count ?? 0) + 1, last: "9999" }, ...rest];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(memory));
  } catch {
    /* ignora */
  }
  listeners.forEach((l) => l(memory!));
}

export function useSongs(): SongSuggestion[] {
  const [songs, setSongs] = useState<SongSuggestion[]>([]);
  useEffect(() => {
    setSongs(memory ?? readLocal());
    listeners.add(setSongs);
    if (!memory) refreshSongs();
    return () => {
      listeners.delete(setSongs);
    };
  }, []);
  return songs;
}
