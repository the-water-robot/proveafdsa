// Importa il repertorio dal canzoniere locale (../canzoniere) in lib/repertoire.ts.
// Uso:  node scripts/sync-canzoniere.mjs [percorso-canzoniere]
// Copia solo titolo, emoji, tonalità, album e slug (MAI password né testi).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || path.join(process.cwd(), "..", "canzoniere"));
const songsDir = path.join(root, "songs");
if (!fs.existsSync(songsDir)) {
  console.error(`Canzoniere non trovato in ${songsDir}`);
  process.exit(1);
}

// album: slug → titolo/emoji leggendo lib/albums.ts (parse leggero, senza eseguire codice)
const albumsSrc = fs.readFileSync(path.join(root, "lib", "albums.ts"), "utf8");
const albums = {};
for (const m of albumsSrc.matchAll(/slug:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*emoji:\s*"([^"]+)"/g)) {
  albums[m[1]] = { title: m[2], emoji: m[3] };
}

const songs = [];
for (const album of fs.readdirSync(songsDir).sort()) {
  const dir = path.join(songsDir, album);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.(cho|chordpro)$/.test(file)) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const meta = (k) => src.match(new RegExp(`^\\{${k}:\\s*(.+?)\\s*\\}`, "m"))?.[1];
    const title = meta("title") || meta("t");
    if (!title) continue;
    songs.push({
      title,
      slug: file.replace(/^\d+-/, "").replace(/\.(cho|chordpro)$/, ""),
      emoji: meta("emoji") || albums[album]?.emoji || "🎵",
      key: meta("key") || undefined,
      album: albums[album]?.title || album,
    });
  }
}

const out = `// GENERATO da scripts/sync-canzoniere.mjs — non modificare a mano.
// Repertorio dal canzoniere (${songs.length} canzoni). Rilancia lo script quando aggiungete pezzi.
export const CANZONIERE_URL = "https://canzoniere-afdsa.vercel.app";

export interface RepertoireSong {
  title: string;
  slug: string;
  emoji: string;
  key?: string;
  album: string;
}

export const REPERTOIRE: RepertoireSong[] = ${JSON.stringify(songs, null, 2)};
`;
fs.writeFileSync(path.join(process.cwd(), "lib", "repertoire.ts"), out);
console.log(`lib/repertoire.ts: ${songs.length} canzoni da ${Object.keys(albums).length} album`);
