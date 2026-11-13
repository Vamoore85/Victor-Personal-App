/*
 * Meeting audio: one recording or imported file per meeting, audio only.
 *
 * Vercel limits a request or response body to 4.5 MB, so audio travels in
 * parts of at most 3.5 MB, each kept as its own private file with its own
 * SHA-256. Nothing is public. Transcription happens on the owner's Mac, which
 * fetches the parts over the approved Wade link and posts back the result.
 */

export const PART_BYTES = 3.5 * 1024 * 1024;
export const MAX_AUDIO_MB = 60;
export const MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024;
export const MAX_PARTS = Math.ceil(MAX_AUDIO_BYTES / PART_BYTES);

// Fixed result labels shared with the Mac worker. Never anything invented in their place.
export const NO_AUDIO = "No audio captured";
export const TRANSCRIPT_FAILED = "Transcript failed";
export const TAKEAWAY_UNAVAILABLE = "Takeaway unavailable (could not produce exactly four sentences)";

export const AUDIO_EXTENSIONS = ["m4a", "mp3", "wav", "webm", "ogg"] as const;
export const AUDIO_ACCEPT = ".m4a,.mp3,.wav,.webm,.ogg,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav,audio/x-wav,audio/webm,audio/ogg";
const EXT: Record<string, string> = { "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/webm": "webm", "audio/ogg": "ogg" };
// What a browser may say about these files; the bytes decide the real type.
const DECLARED: Record<string, string> = {
  "audio/mp4": "audio/mp4", "audio/x-m4a": "audio/mp4", "audio/m4a": "audio/mp4", "audio/aac": "audio/mp4",
  "audio/mpeg": "audio/mpeg", "audio/mp3": "audio/mpeg", "audio/wav": "audio/wav", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav",
  "audio/webm": "audio/webm", "video/webm": "audio/webm", "audio/ogg": "audio/ogg", "application/ogg": "audio/ogg",
};

const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");

/** The audio type from the file's first bytes, or null when it isn't one of the allowed audio formats. */
export function sniffAudio(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm"; // EBML (WebM / Matroska)
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (/^(heic|heix|hevc|mif1|msf1|avif|qt {2})$/.test(brand)) return null; // photos and QuickTime video
    return "audio/mp4"; // M4A / M4B / isom / mp42 (Voice Memos, Safari recordings)
  }
  return null;
}

/** True when the browser's declared type is absent, generic, or the same family as the real type. */
export function declaredMatches(declared: string, real: string) {
  const d = declared.split(";")[0].trim().toLowerCase();
  return !d || d === "application/octet-stream" || DECLARED[d] === real;
}

export function extensionOk(name: string) {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
  return !ext || (AUDIO_EXTENSIONS as readonly string[]).includes(ext) || ext === "mp4";
}

/** A safe display name with the real type's extension. */
export function safeAudioName(raw: string, type: string) {
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120) || "audio";
  const ext = EXT[type] ?? "audio";
  return new RegExp(`\\.${ext}$`, "i").test(base) ? base : `${base.replace(/\.[A-Za-z0-9]{1,5}$/, "")}.${ext}`;
}

export const partKey = (audioId: string, index: number) => `aa-audio-${audioId}-${index}`;
export const transcriptKey = (audioId: string) => `aa-transcript-${audioId}`;
export const confirmationFileKey = (id: string) => `aa-confirmation-${id}`;

/*
 * Sentence splitting used to check a takeaway is exactly four sentences.
 * The Mac worker uses the same rules (local/wade_local/aa_meetings.py).
 */
const ABBREV = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|e\.g|i\.e|No)\.$/i;
export function sentences(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const out: string[] = [];
  let cur = "";
  const parts = flat.split(/(?<=[.!?]["'”’)\]]*)\s+/);
  for (const p of parts) {
    cur = cur ? `${cur} ${p}` : p;
    if (ABBREV.test(cur)) continue;
    out.push(cur); cur = "";
  }
  if (cur) out.push(cur);
  return out;
}
export function exactlyFour(text: string) {
  const s = sentences(text);
  return s.length === 4 && s.every((x) => /[.!?]["'”’)\]]*$/.test(x) && /[A-Za-z]/.test(x));
}
