// Tipi di file — isomorfo (client + server).
// Il tipo dichiarato non è affidabile: Drive ha .m4a salvati come "audio/mpeg", Android a volte
// non dà nessun tipo, iPhone usa "audio/x-m4a"… Quindi l'estensione ha la precedenza.

export type Kind = "audio" | "video" | "image" | "other";

const BY_EXT: Record<string, { mime: string; kind: Kind }> = {
  // audio (iPhone, Android, registratori, DAW)
  m4a: { mime: "audio/mp4", kind: "audio" },
  m4b: { mime: "audio/mp4", kind: "audio" },
  mp4a: { mime: "audio/mp4", kind: "audio" },
  aac: { mime: "audio/aac", kind: "audio" },
  mp3: { mime: "audio/mpeg", kind: "audio" },
  wav: { mime: "audio/wav", kind: "audio" },
  wave: { mime: "audio/wav", kind: "audio" },
  ogg: { mime: "audio/ogg", kind: "audio" },
  oga: { mime: "audio/ogg", kind: "audio" },
  opus: { mime: "audio/ogg", kind: "audio" },
  flac: { mime: "audio/flac", kind: "audio" },
  amr: { mime: "audio/amr", kind: "audio" },
  awb: { mime: "audio/amr-wb", kind: "audio" },
  "3ga": { mime: "audio/3gpp", kind: "audio" },
  caf: { mime: "audio/x-caf", kind: "audio" },
  aif: { mime: "audio/aiff", kind: "audio" },
  aiff: { mime: "audio/aiff", kind: "audio" },
  aifc: { mime: "audio/aiff", kind: "audio" },
  wma: { mime: "audio/x-ms-wma", kind: "audio" },
  weba: { mime: "audio/webm", kind: "audio" },
  // video
  mp4: { mime: "video/mp4", kind: "video" },
  m4v: { mime: "video/mp4", kind: "video" },
  mov: { mime: "video/quicktime", kind: "video" },
  qt: { mime: "video/quicktime", kind: "video" },
  "3gp": { mime: "video/3gpp", kind: "video" },
  "3g2": { mime: "video/3gpp2", kind: "video" },
  mkv: { mime: "video/x-matroska", kind: "video" },
  avi: { mime: "video/x-msvideo", kind: "video" },
  // immagini
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  png: { mime: "image/png", kind: "image" },
  gif: { mime: "image/gif", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  heic: { mime: "image/heic", kind: "image" },
  heif: { mime: "image/heif", kind: "image" },
  avif: { mime: "image/avif", kind: "image" },
  dng: { mime: "image/x-adobe-dng", kind: "image" },
};

/** Estensioni accettate dal selettore file (oltre a audio/*, video/*, image/*). */
export const ACCEPT = ["audio/*", "video/*", "image/*", ...Object.keys(BY_EXT).map((e) => `.${e}`)].join(",");

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

/** Tipo di contenuto (audio/video/foto) dal nome e/o dal mime dichiarato. */
export function kindOf(name: string, declared?: string): Kind {
  const e = extOf(name);
  // webm: può essere sia audio che video → decide il mime dichiarato
  if (e === "webm") return (declared || "").startsWith("video/") ? "video" : "audio";
  if (BY_EXT[e]) return BY_EXT[e].kind;
  const t = (declared || "").toLowerCase();
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/")) return "image";
  return "other";
}

/** Mime "giusto" per un file: dall'estensione se nota, altrimenti quello dichiarato. */
export function mimeFor(name: string, declared?: string): string {
  const e = extOf(name);
  const d = (declared || "").split(";")[0].trim().toLowerCase();
  if (e === "webm") return d.startsWith("video/") ? "video/webm" : "audio/webm";
  return BY_EXT[e]?.mime || d || "application/octet-stream";
}

/** Formati immagine che tutti i browser sanno mostrare (gli altri, es. HEIC, passano dalla miniatura di Drive). */
export function isWebImage(name: string, declared?: string): boolean {
  return /^image\/(jpeg|png|gif|webp)$/.test(mimeFor(name, declared));
}
