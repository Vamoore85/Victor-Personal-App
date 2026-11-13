import { createHash, randomUUID } from "node:crypto";
import { asLinks, bearer, findByToken, linkStatus, WADE_LINKS_DOC } from "@/lib/wade-link";
import { NO_AUDIO, TAKEAWAY_UNAVAILABLE, TRANSCRIPT_FAILED, confirmationFileKey, exactlyFour, partKey, transcriptKey } from "./audio";
import { knownGmailIds, matchConfirmation } from "./confirmations";
import { EXTENSIONS, safeName, sniffType } from "./evidence";
import { ORGANIZER_EMAIL, type ConfirmationFile, type MeetingAudio, type OrganizerConfirmation } from "./model";
import { TooLarge, boundedBody, readMeetings, updateMeetings, type Store } from "./server";

/*
 * Endpoints for Raven on the owner's Mac, over the same approved Wade link as
 * /api/wade/money and /api/wade/mcp: server to server only (a request with a
 * browser Origin is refused), and only while the link Victor approved from a
 * full sign-in is approved and unexpired.
 *
 *   GET  /api/wade/aa/pending       meetings whose audio awaits a transcript (read only)
 *   GET  /api/wade/aa/audio         one part of one pending audio file (read only)
 *   POST /api/wade/aa/result        the transcript result for that one audio file
 *   POST /api/wade/aa/confirmation  one organizer confirmation email, deduped by Gmail id
 */

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

export async function wadeAuth(req: Request, store: Store, now = Date.now()): Promise<Response | null> {
  const token = bearer(req.headers.get("authorization"));
  if (!token || req.headers.get("origin")) return reply({ error: "Unauthorized" }, 401);
  if (!store.configured()) return reply({ error: "Maverick's database isn't set up." }, 503);
  let link;
  try { link = findByToken(asLinks((await store.readDoc(WADE_LINKS_DOC))?.data ?? null), token); }
  catch { return reply({ error: "Maverick is unavailable." }, 503); }
  const state = linkStatus(link, now);
  if (state !== "approved") return reply({ error: "Approve Raven in Maverick first.", link_state: state }, 403);
  return null;
}

export async function wadePending(req: Request, store: Store) {
  const denied = await wadeAuth(req, store); if (denied) return denied;
  try {
    const data = await readMeetings(store);
    const items = data.meetings.filter((m) => m.audio?.status === "awaiting-transcript").map((m) => {
      const a = m.audio!;
      return {
        meetingId: m.id, audioId: a.id, date: m.date, time: m.time, type: a.type, size: a.size, sha256: a.sha256, parts: a.parts,
        useClaudeTakeaway: m.useClaudeTakeaway === true, participants: m.participants ?? [],
      };
    });
    return reply({ items });
  } catch (e) { console.error("wade aa pending", e instanceof Error ? e.name : "error"); return reply({ error: "Couldn't read meetings." }, 502); }
}

export async function wadeAudio(req: Request, store: Store) {
  const denied = await wadeAuth(req, store); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  try {
    const a = (await readMeetings(store)).meetings.find((m) => m.id === q.get("meetingId"))?.audio;
    // Only audio still waiting for its transcript can be fetched.
    if (!a || a.id !== q.get("audioId") || a.status !== "awaiting-transcript") return reply({ error: "Not found." }, 404);
    const part = a.parts.find((p) => String(p.index) === q.get("part"));
    if (!part) return reply({ error: "Not found." }, 404);
    const f = await store.getFile(partKey(a.id, part.index));
    if (!f || createHash("sha256").update(f.data).digest("hex") !== part.sha256) return reply({ error: "The stored audio doesn't match its recorded hash." }, 409);
    return new Response(new Uint8Array(f.data), { headers: { ...HEADERS, "Content-Type": "application/octet-stream", "Content-Length": String(f.data.length), "X-Content-SHA256": part.sha256 } });
  } catch (e) { console.error("wade aa audio", e instanceof Error ? e.name : "error"); return reply({ error: "Couldn't read the audio." }, 502); }
}

async function readJson(req: Request, max: number) {
  try {
    const v = JSON.parse((await boundedBody(req, max)).toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (e) { if (e instanceof TooLarge) throw e; return null; }
}

class Refused extends Error { constructor(message: string, readonly status: number) { super(message); } }

/**
 * {meetingId, audioId, status: "transcribed"|"no-audio"|"failed", transcript?, takeaway?, engine?, reason?}
 * Changes only that meeting's audio result, and only while it is awaiting a transcript.
 */
export async function wadeResult(req: Request, store: Store, now = new Date()) {
  const denied = await wadeAuth(req, store); if (denied) return denied;
  let b: Record<string, unknown> | null;
  try { b = await readJson(req, 3.5 * 1024 * 1024); } catch { return reply({ error: "The result is too large." }, 413); }
  if (!b) return reply({ error: "Invalid request." }, 400);
  const status = b.status, at = now.toISOString();
  const reason = typeof b.reason === "string" ? b.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  let patch: Partial<MeetingAudio>;
  let transcript: string | null = null;
  if (status === "no-audio") patch = { status: "no-audio", result: NO_AUDIO, reason: reason || undefined };
  else if (status === "failed") patch = { status: "failed", result: TRANSCRIPT_FAILED, reason: reason || "No reason given." };
  else if (status === "transcribed") {
    transcript = typeof b.transcript === "string" ? b.transcript.trim() : "";
    const takeaway = typeof b.takeaway === "string" ? b.takeaway.replace(/\s+/g, " ").trim() : "";
    if (!transcript || transcript.length > 1_000_000) return reply({ error: "A transcript is required." }, 400);
    if (takeaway !== TAKEAWAY_UNAVAILABLE && (takeaway.length > 2000 || !exactlyFour(takeaway))) return reply({ error: "The takeaway must be exactly four sentences." }, 400);
    if (b.engine !== "local" && b.engine !== "claude") return reply({ error: "Say which engine wrote the takeaway." }, 400);
    patch = { status: "transcribed", result: "Transcribed", takeaway, takeawayEngine: b.engine as "local" | "claude", hasTranscript: true, reason: reason || undefined };
  } else return reply({ error: "Unknown status." }, 400);

  try {
    const pre = (await readMeetings(store)).meetings.find((m) => m.id === b!.meetingId);
    if (!pre?.audio || pre.audio.id !== b.audioId) return reply({ error: "Not found." }, 404);
    if (pre.audio.status !== "awaiting-transcript") return reply({ error: "That audio already has a result." }, 409);
    // Claude may write a takeaway only for a meeting where the owner turned that on.
    if (patch.takeawayEngine === "claude" && pre.useClaudeTakeaway !== true) return reply({ error: "Claude isn't turned on for this meeting." }, 403);
    if (transcript !== null) await store.putFile(transcriptKey(pre.audio.id), "text/plain; charset=utf-8", Buffer.from(transcript, "utf8"));
    const saved = await updateMeetings(store, (d) => {
      const m = d.meetings.find((x) => x.id === b!.meetingId);
      if (!m?.audio || m.audio.id !== b!.audioId) throw new Refused("Not found.", 404);
      if (m.audio.status !== "awaiting-transcript") throw new Refused("That audio already has a result.", 409);
      const audio = { ...m.audio, ...patch, processedAt: at };
      const label = patch.status === "transcribed" ? `Transcript and takeaway saved from the Mac (${patch.takeawayEngine === "claude" ? "Claude, turned on by owner" : "local model"})` : patch.result!;
      const next = { ...m, audio, updatedAt: at, history: [...m.history, { at, action: label }].slice(-200) };
      return { ...d, meetings: d.meetings.map((x) => (x.id === m.id ? next : x)) };
    });
    void saved;
    return reply({ ok: true, status: patch.status });
  } catch (e) {
    if (e instanceof Refused) return reply({ error: e.message }, e.status);
    console.error("wade aa result", e instanceof Error ? e.name : "error");
    return reply({ error: "Couldn't save the result." }, 502);
  }
}

const GMAIL_ID = /^[A-Za-z0-9_-]{6,64}$/;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/**
 * {gmailId, subject, sender, date, body, attachments: [{name, type, data (base64)}]}
 * Stores the email under "Organizer email confirmation" on the one meeting it matches, or in Needs review.
 * The same Gmail id is never stored twice.
 */
export async function wadeConfirmation(req: Request, store: Store, now = new Date()) {
  const denied = await wadeAuth(req, store); if (denied) return denied;
  let b: Record<string, unknown> | null;
  try { b = await readJson(req, 4.4 * 1024 * 1024); } catch { return reply({ error: "The email is too large." }, 413); }
  if (!b) return reply({ error: "Invalid request." }, 400);
  const gmailId = String(b.gmailId ?? "");
  if (!GMAIL_ID.test(gmailId)) return reply({ error: "A Gmail message id is required." }, 400);
  const date = clip(b.date, 80);
  if (!date || Number.isNaN(Date.parse(date))) return reply({ error: "The email's date is required." }, 400);
  const at = now.toISOString();
  try {
    if (knownGmailIds(await readMeetings(store)).has(gmailId)) return reply({ ok: true, duplicate: true });
  } catch (e) { console.error("wade aa confirmation read", e instanceof Error ? e.name : "error"); return reply({ error: "Couldn't read meetings." }, 502); }

  const attachments: ConfirmationFile[] = [], skipped: string[] = [];
  const raw = Array.isArray(b.attachments) ? b.attachments.slice(0, 10) : [];
  for (const x of raw as Record<string, unknown>[]) {
    const name = clip(x?.name, 200) || "attachment";
    const bytes = typeof x?.data === "string" ? Buffer.from(x.data, "base64") : Buffer.alloc(0);
    const type = bytes.length ? sniffType(bytes) : null;
    // Only PDFs and photos are kept, like supporting records; anything else is listed by name only.
    if (!type || !EXTENSIONS[type]) { skipped.push(name); continue; }
    const file = { id: randomUUID(), name: safeName(name, type), type, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    try { await store.putFile(confirmationFileKey(file.id), type, bytes); attachments.push(file); }
    catch { for (const f of attachments) await store.deleteFile(confirmationFileKey(f.id)).catch(() => undefined); return reply({ error: "Couldn't store the attachments." }, 502); }
  }
  for (const n of (Array.isArray(b.skippedAttachments) ? b.skippedAttachments : []).slice(0, 20)) skipped.push(clip(n, 200));
  const record: OrganizerConfirmation = {
    gmailId, subject: clip(b.subject, 300), sender: clip(b.sender, 300), date: new Date(date).toISOString(), body: clip(b.body, 20000),
    attachments, skippedAttachments: skipped, importedAt: at,
  };
  let outcome: { matched?: string; review?: string; duplicate?: boolean } = {};
  try {
    await updateMeetings(store, (d) => {
      if (knownGmailIds(d).has(gmailId)) { outcome = { duplicate: true }; return d; }
      const match = matchConfirmation(d, record);
      if ("reason" in match) {
        outcome = { review: match.reason };
        return { ...d, needsReview: [...d.needsReview, { ...record, reviewReason: match.reason }].slice(-500) };
      }
      outcome = { matched: match.meetingId };
      return {
        ...d, meetings: d.meetings.map((m) => (m.id !== match.meetingId ? m : {
          ...m, updatedAt: at, confirmations: [...m.confirmations, { ...record, matchedBy: match.by }],
          history: [...m.history, { at, action: `${ORGANIZER_EMAIL} imported from Gmail ("${record.subject.slice(0, 80)}", matched by ${match.by.toLowerCase()}). Attendance answer unchanged.` }].slice(-200),
        })),
      };
    });
  } catch (e) {
    for (const f of attachments) await store.deleteFile(confirmationFileKey(f.id)).catch(() => undefined);
    console.error("wade aa confirmation", e instanceof Error ? e.name : "error");
    return reply({ error: "Couldn't save the email." }, 502);
  }
  if (outcome.duplicate) for (const f of attachments) await store.deleteFile(confirmationFileKey(f.id)).catch(() => undefined);
  return reply({ ok: true, ...outcome });
}
