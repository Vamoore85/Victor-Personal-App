/*
 * Supporting records (a signed slip, a photo of one, a PDF letter) attached to
 * a meeting. The original bytes are stored once under a new id and never
 * rewritten; the SHA-256 recorded at upload is checked again on every
 * download. Attaching a file is the owner's own record, not third-party
 * verification, and never changes a meeting's attendance answer.
 */

// Vercel accepts request bodies up to 4.5 MB, so files stay under 4 MB.
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
export const MAX_FILES_PER_MEETING = 10;

const startsWith = (b: Buffer, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);

/** The file's real type from its first bytes, or null when it isn't an allowed PDF or photo. */
export function sniffType(b: Buffer): string | null {
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(b.subarray(8, 12).toString("latin1"))) return "image/heic";
  return null;
}

export const EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** A safe display file name: no paths or control characters, with the real type's extension. */
export function safeName(raw: string, type: string) {
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120) || "record";
  const ext = EXTENSIONS[type];
  const ok = ext === "jpg" ? /\.jpe?g$/i : new RegExp(`\\.${ext}$`, "i");
  return ok.test(base) ? base : `${base.replace(/\.[A-Za-z0-9]{1,5}$/, "")}.${ext}`;
}

export const fileKey = (id: string) => `aa-evidence-${id}`;
