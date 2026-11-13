import { createHash, randomUUID } from "node:crypto";
import { sameOrigin, signedIn } from "@/lib/plaid-server";
import {
  addDays, appendMeetings, applyCancellations, cancel, createMeeting, easternToday, edit, plannedMeetings, ruleInput, syncPlans, transition,
  easternTime, normalize, type Attendance, type Evidence, type Meeting, type MeetingAudio, type MeetingData,
} from "./model";
import { MAX_AUDIO_BYTES, MAX_AUDIO_MB, MAX_PARTS, PART_BYTES, confirmationFileKey, declaredMatches, extensionOk, partKey, safeAudioName, sniffAudio, transcriptKey } from "./audio";
import { calendarCancellations, importCalendar } from "./calendar";
import { MAX_EVIDENCE_BYTES, MAX_FILES_PER_MEETING, fileKey, safeName, sniffType } from "./evidence";
import { ReportError, buildReport, parseOptions, reportCsv, reportPdf, type Report } from "./report";
import { DOC_KEY, TooLarge, boundedBody, readMeetings, updateMeetings, type Store } from "./server";

/*
 * Request handlers for the tracker, written against a Store so tests can run
 * them with real Requests and an in-memory database. Every handler needs the
 * owner's full session; every write also needs a same-origin request.
 */

export const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

function guard(req: Request, store: Store, write: boolean) {
  if (!signedIn(req)) return json({ error: "Sign in first." }, 401);
  if (write && !sameOrigin(req)) return json({ error: "Forbidden" }, 403);
  if (!store.configured()) return json({ error: "The private database is not connected." }, 503);
  return null;
}

export async function getMeetings(req: Request, store: Store) {
  const denied = guard(req, store, false); if (denied) return denied;
  try { return json(await readMeetings(store)); }
  catch (e) { console.error("aa-meetings load", e); return json({ error: "Couldn't load meetings. Please try again." }, 502); }
}

export class UserError extends Error {}
export const fail = (message: string): never => { throw new UserError(message); };
const replaceMeeting = (d: MeetingData, m: Meeting, next: Meeting) => (next === m ? d : { ...d, meetings: d.meetings.map((x) => (x.id === m.id ? next : x)) });
const logged = (m: Meeting, at: string, action: string, patch: Partial<Meeting> = {}): Meeting => ({ ...m, ...patch, updatedAt: at, history: [...m.history, { at, action }].slice(-200) });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** The stored files that belong to a meeting's audio (its parts and transcript). */
export const audioKeys = (a: MeetingAudio | undefined) => (a ? [...a.parts.map((p) => partKey(a.id, p.index)), transcriptKey(a.id)] : []);

export async function postMeetings(req: Request, store: Store, now = new Date()) {
  const denied = guard(req, store, true); if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await boundedBody(req, 2 * 1024 * 1024)).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return json({ error: "Use a valid request under 2 MB." }, 400); }
  const at = now.toISOString();
  let added = 0, updated = 0, cancelled = 0;
  let cleanup: string[] = [];
  try {
    // Parsing the calendar file is done once, outside the save retries.
    const calendar = body.action === "import-calendar"
      ? (() => { try { return importCalendar(String(body.ics ?? ""), String(body.match ?? ""), String(body.from ?? ""), String(body.through ?? ""), at, randomUUID); } catch (e) { return fail((e as Error).message); } })()
      : null;
    const saved = await updateMeetings(store, (d): MeetingData => {
      added = updated = cancelled = 0;
      const wrap = <T,>(fn: () => T) => { try { return fn(); } catch (e) { return fail((e as Error).message); } };
      switch (body.action) {
        case "plan": {
          const today = easternToday(now);
          const r = wrap(() => plannedMeetings(d, today, addDays(today, 42), at, randomUUID));
          added = r.added; return r.added || r.updated ? r.data : d;
        }
        case "add": {
          const r = appendMeetings(d, [wrap(() => createMeeting(body, randomUUID(), at))], at);
          if (!r.added) fail("That meeting is already in your tracker.");
          added = r.added; return r.data;
        }
        case "import-calendar": {
          const r = appendMeetings(d, calendar!.meetings, at);
          const c = applyCancellations(r.data, calendarCancellations(d, calendar!), at);
          added = r.added; updated = r.updated; cancelled = c.cancelled;
          return added || updated || cancelled ? c.data : d;
        }
        case "settings": {
          const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
          const profile = { name: text(body.name, 120), reportTitle: text(body.reportTitle, 120) || d.profile.reportTitle, court: text(body.court, 180), caseNumbers: text(body.caseNumbers, 180) };
          return { ...d, profile };
        }
        case "rules": {
          if (!Array.isArray(body.rules) || body.rules.length > 20) fail("Send up to 20 recurring plans.");
          const rules = (body.rules as Record<string, unknown>[]).map((r) => wrap(() => ruleInput(r ?? {}, typeof r?.id === "string" && /^[\w-]{1,64}$/.test(r.id) ? r.id : randomUUID())));
          return syncPlans(d, rules, at);
        }
        case "assign-confirmation": {
          // The owner decides which meeting a "Needs review" email belongs to.
          const c = d.needsReview.find((x) => x.gmailId === body.gmailId) ?? fail("That email isn't waiting for review.");
          const m = d.meetings.find((x) => x.id === body.id && !x.cancelled) ?? fail("Meeting not found.");
          const moved = { ...c, matchedBy: "Owner assigned it from Needs review", reviewReason: undefined, dismissedAt: undefined };
          const next = logged(m, at, `Owner assigned organizer email confirmation "${c.subject.slice(0, 80)}" to this meeting`, { confirmations: [...m.confirmations, moved] });
          return { ...replaceMeeting(d, m, next), needsReview: d.needsReview.filter((x) => x.gmailId !== c.gmailId) };
        }
        case "dismiss-confirmation": {
          // Kept (so the same email is never imported again), only hidden from the review list.
          const c = d.needsReview.find((x) => x.gmailId === body.gmailId) ?? fail("That email isn't waiting for review.");
          if (c.dismissedAt) return d;
          return { ...d, needsReview: d.needsReview.map((x) => (x.gmailId === c.gmailId ? { ...x, dismissedAt: at } : x)) };
        }
        case "topics": {
          if (!Array.isArray(body.topics) || body.topics.length > 200) fail("Send up to 200 topics.");
          const topics = [...new Set((body.topics as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 300)).filter(Boolean))];
          return { ...d, topics };
        }
      }
      const m = d.meetings.find((x) => x.id === body.id) ?? fail("Meeting not found.");
      let next = m;
      switch (body.action) {
        case "status": next = wrap(() => transition(m, body.state as Attendance, at)); break;
        case "edit": next = wrap(() => edit(m, body, d.meetings, at)); break;
        case "cancel": next = wrap(() => cancel(m, at)); break;
        case "withdraw-evidence": {
          const e = m.evidence.find((x) => x.id === body.evidenceId) ?? fail("Supporting record not found.");
          if (e.withdrawnAt) return d;
          next = { ...m, updatedAt: at, evidence: m.evidence.map((x) => (x.id === e.id ? { ...x, withdrawnAt: at } : x)), history: [...m.history, { at, action: `Owner withdrew supporting record "${e.name}" from reports (file kept unchanged)` }] };
          break;
        }
        case "audio-settings": {
          // Only the signed-in owner can turn Claude on, one meeting at a time. It is off by default.
          const useClaudeTakeaway = body.useClaudeTakeaway === true;
          const participants = Array.isArray(body.participants)
            ? [...new Set((body.participants as unknown[]).filter((p): p is string => typeof p === "string").map((p) => p.trim().replace(/\s+/g, " ").slice(0, 60)).filter((p) => p.length >= 2))].slice(0, 50)
            : m.participants ?? [];
          if (useClaudeTakeaway === (m.useClaudeTakeaway === true) && JSON.stringify(participants) === JSON.stringify(m.participants ?? [])) return d;
          const what = useClaudeTakeaway !== (m.useClaudeTakeaway === true)
            ? (useClaudeTakeaway ? "Owner turned on: use Claude for this takeaway" : "Owner turned off Claude for this takeaway (local model on the Mac)")
            : "Owner updated the names kept out of the takeaway";
          next = logged(m, at, what, { useClaudeTakeaway, participants });
          break;
        }
        case "self-times": {
          const joined = String(body.joined ?? ""), left = String(body.left ?? "");
          if (!HHMM.test(joined) || !HHMM.test(left)) fail("Enter join and leave times.");
          if (left <= joined) fail("The leave time must be after the join time.");
          next = logged(m, at, `Owner entered join ${joined} and leave ${left} (self-reported)`, { selfTimes: { joined, left, source: "manual", at } });
          break;
        }
        case "delete-audio": {
          const a = m.audio ?? fail("This meeting has no audio.");
          cleanup = audioKeys(a);
          next = logged(m, at, `Owner deleted the meeting audio "${a.name}" and its transcript`, { audio: undefined });
          break;
        }
        default: fail("Unknown action.");
      }
      return replaceMeeting(d, m, next);
    });
    if (saved.changed) for (const k of cleanup) await store.deleteFile(k).catch(() => undefined);
    return json({ data: saved.data, added, updated, cancelled, saved: saved.changed });
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error("aa-meetings save", e);
    return json({ error: (e as Error).message === "Another device is saving. Please try again." ? (e as Error).message : "Couldn't save. Nothing was changed. Please try again." }, 502);
  }
}

export async function uploadEvidence(req: Request, store: Store, now = new Date()) {
  const denied = guard(req, store, true); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const meetingId = q.get("meetingId") ?? "";
  const declared = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  let bytes: Buffer;
  try { bytes = await boundedBody(req, MAX_EVIDENCE_BYTES); }
  catch (e) { return e instanceof TooLarge ? json({ error: "That file is over 4 MB. Try a photo or a smaller PDF." }, 413) : json({ error: "The upload didn't finish. Try again." }, 400); }
  if (!bytes.length) return json({ error: "The file is empty." }, 400);
  const type = sniffType(bytes);
  if (!type) return json({ error: "Use a PDF or a photo (JPG, PNG, WebP or HEIC)." }, 415);
  const declaredOk = declared === type || (declared === "image/heif" && type === "image/heic") || declared === "application/octet-stream" || declared === "";
  if (!declaredOk) return json({ error: "The file's contents don't match its type." }, 415);
  const current = await readMeetings(store).catch(() => null);
  if (!current) return json({ error: "Couldn't reach your saved meetings. Nothing was uploaded." }, 502);
  const meeting = current.meetings.find((m) => m.id === meetingId);
  if (!meeting) return json({ error: "Meeting not found." }, 404);
  if (meeting.evidence.length >= MAX_FILES_PER_MEETING) return json({ error: `A meeting can hold up to ${MAX_FILES_PER_MEETING} records.` }, 400);

  const at = now.toISOString();
  const evidence: Evidence = { id: randomUUID(), name: safeName(q.get("name") ?? "", type), type, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedAt: at };
  // A new id every time, so an original file is never overwritten.
  try { await store.putFile(fileKey(evidence.id), type, bytes); }
  catch (e) { console.error("aa evidence upload", e); return json({ error: "Couldn't save the file. Nothing was attached." }, 502); }
  try {
    const saved = await updateMeetings(store, (d) => {
      const m = d.meetings.find((x) => x.id === meetingId) ?? fail("Meeting not found.");
      if (m.evidence.length >= MAX_FILES_PER_MEETING) fail(`A meeting can hold up to ${MAX_FILES_PER_MEETING} records.`);
      const next = { ...m, updatedAt: at, evidence: [...m.evidence, evidence], history: [...m.history, { at, action: `Owner attached supporting record "${evidence.name}" (SHA-256 ${evidence.sha256.slice(0, 12)}…). Attendance answer unchanged.` }] };
      return { ...d, meetings: d.meetings.map((x) => (x.id === m.id ? next : x)) };
    });
    return json({ data: saved.data, evidence });
  } catch (e) {
    await store.deleteFile(fileKey(evidence.id)).catch(() => undefined); // never left unreferenced
    if (e instanceof UserError) return json({ error: e.message }, e.message === "Meeting not found." ? 404 : 400);
    console.error("aa evidence link", e);
    return json({ error: "Couldn't attach the file. Nothing was saved." }, 502);
  }
}

export async function downloadEvidence(req: Request, store: Store, id: string) {
  return serveRecord(req, store, id, (d) => d.meetings.flatMap((m) => m.evidence), fileKey);
}

/** An attachment of an imported organizer email, hash-checked like a supporting record. */
export async function downloadConfirmationFile(req: Request, store: Store, id: string) {
  return serveRecord(req, store, id, (d) => [...d.meetings.flatMap((m) => m.confirmations), ...d.needsReview].flatMap((c) => c.attachments), confirmationFileKey);
}

async function serveRecord(req: Request, store: Store, id: string, list: (d: MeetingData) => { id: string; name: string; type: string; sha256: string }[], key: (id: string) => string) {
  const denied = guard(req, store, false); if (denied) return denied;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Not found." }, 404);
  try {
    const data = await readMeetings(store);
    const record = list(data).find((e) => e.id === id);
    if (!record) return json({ error: "Not found." }, 404);
    const file = await store.getFile(key(id));
    if (!file) return json({ error: "The original file is missing." }, 404);
    const hash = createHash("sha256").update(file.data).digest("hex");
    if (hash !== record.sha256) return json({ error: "The stored file doesn't match its recorded hash. It was not served." }, 409);
    const ascii = record.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": record.type, "Content-Length": String(file.data.length),
        "Content-Disposition": `${new URL(req.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(record.name)}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Content-SHA256": hash,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) { console.error("aa evidence download", e); return json({ error: "Couldn't load the file. Please try again." }, 502); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const validIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * Meeting audio from the owner, recorded in the browser or imported, in parts.
 * POST ?meetingId&uploadId&part=N  with up to 3.5 MB of bytes: stores one part.
 * POST ?meetingId&uploadId&finish=1 with JSON {parts, name, type, source, replace, startedAt?, stoppedAt?}:
 * checks the whole file and attaches it to the meeting as "awaiting transcript".
 */
export async function uploadAudio(req: Request, store: Store, now = new Date()) {
  const denied = guard(req, store, true); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const meetingId = q.get("meetingId") ?? "", uploadId = q.get("uploadId") ?? "";
  if (!UUID.test(uploadId)) return json({ error: "Start the upload again." }, 400);
  const current = await readMeetings(store).catch(() => null);
  if (!current) return json({ error: "Couldn't reach your saved meetings. Nothing was uploaded." }, 502);
  const meeting = current.meetings.find((m) => m.id === meetingId);
  if (!meeting) return json({ error: "Meeting not found." }, 404);
  if (meeting.audio?.id === uploadId) return json({ error: "That upload is already saved." }, 409);
  return q.get("finish") === "1" ? finishAudio(req, store, meeting, uploadId, now) : storeAudioPart(req, store, q, uploadId);
}

async function storeAudioPart(req: Request, store: Store, q: URLSearchParams, uploadId: string) {
  const index = Number(q.get("part"));
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PARTS) return json({ error: `Audio files can be up to ${MAX_AUDIO_MB} MB.` }, 413);
  let bytes: Buffer;
  try { bytes = await boundedBody(req, PART_BYTES); }
  catch (e) { return e instanceof TooLarge ? json({ error: "An upload part was too large." }, 413) : json({ error: "The upload didn't finish. Try again." }, 400); }
  if (!bytes.length) return json({ error: "The file is empty." }, 400);
  // The first part decides the type, so a non-audio file is refused before the rest is sent.
  if (index === 0 && !sniffAudio(bytes)) return json({ error: "Use an audio file: M4A, MP3, WAV, WebM or OGG." }, 415);
  try { await store.putFile(partKey(uploadId, index), "application/octet-stream", bytes); }
  catch (e) { console.error("aa audio part", e); return json({ error: "Couldn't save the audio. Nothing was attached." }, 502); }
  return json({ part: index, size: bytes.length, sha256: sha(bytes) });
}

async function finishAudio(req: Request, store: Store, meeting: Meeting, uploadId: string, now: Date) {
  let body: Record<string, unknown>;
  try { body = JSON.parse((await boundedBody(req, 64 * 1024)).toString("utf8")); if (!body || typeof body !== "object") throw new Error(); }
  catch { return json({ error: "Use a valid request." }, 400); }
  const count = Number(body.parts);
  const drop = async () => { for (let i = 0; i < MAX_PARTS; i++) await store.deleteFile(partKey(uploadId, i)).catch(() => undefined); };
  const refuse = async (error: string, status: number) => { await drop(); return json({ error }, status); };
  if (!Number.isInteger(count) || count < 1 || count > MAX_PARTS) return refuse(`Audio files can be up to ${MAX_AUDIO_MB} MB.`, 413);
  const name = String(body.name ?? "");
  if (!extensionOk(name)) return refuse("Use an audio file: M4A, MP3, WAV, WebM or OGG.", 415);
  const parts: MeetingAudio["parts"] = [];
  const hash = createHash("sha256");
  let size = 0, type: string | null = null;
  try {
    for (let i = 0; i < count; i++) {
      const f = await store.getFile(partKey(uploadId, i));
      if (!f) return refuse("Part of the audio is missing. Try the upload again.", 400);
      if (i === 0) type = sniffAudio(f.data);
      size += f.data.length; hash.update(f.data);
      parts.push({ index: i, size: f.data.length, sha256: sha(f.data) });
    }
  } catch (e) { console.error("aa audio finish", e); return json({ error: "Couldn't check the audio. Try again." }, 502); }
  if (!type) return refuse("Use an audio file: M4A, MP3, WAV, WebM or OGG.", 415);
  if (!declaredMatches(String(body.type ?? ""), type)) return refuse("The file's contents don't match its type.", 415);
  if (size > MAX_AUDIO_BYTES) return refuse(`Audio files can be up to ${MAX_AUDIO_MB} MB.`, 413);
  const source = body.source === "recording" ? "recording" as const : "import" as const;
  const at = now.toISOString();
  const audio: MeetingAudio = { id: uploadId, source, name: safeAudioName(name, type), type, size, sha256: hash.digest("hex"), parts, uploadedAt: at, status: "awaiting-transcript" };
  // Start/Stop of the owner's own recording are his self-reported join and leave times.
  const times = source === "recording" && validIso(body.startedAt) && validIso(body.stoppedAt) && Date.parse(body.stoppedAt) > Date.parse(body.startedAt)
    ? { joined: easternTime(new Date(body.startedAt)), left: easternTime(new Date(body.stoppedAt)), source: "recording" as const, at } : undefined;
  let old: MeetingAudio | undefined;
  try {
    const saved = await updateMeetings(store, (d) => {
      const m = d.meetings.find((x) => x.id === meeting.id) ?? fail("Meeting not found.");
      if (m.audio && body.replace !== true) fail("This meeting already has audio. Confirm that the new audio should replace it.");
      old = m.audio;
      const what = `${source === "recording" ? "Owner recorded" : "Owner imported"} meeting audio "${audio.name}" (SHA-256 ${audio.sha256.slice(0, 12)}…)${old ? `, replacing "${old.name}"` : ""}. Awaiting transcript on the Mac.`;
      return replaceMeeting(d, m, logged(m, at, what, { audio, ...(times ? { selfTimes: times } : {}) }));
    });
    for (const k of audioKeys(old)) await store.deleteFile(k).catch(() => undefined);
    return json({ data: saved.data, audio });
  } catch (e) {
    await drop();
    if (e instanceof UserError) return json({ error: e.message }, /already has audio/.test(e.message) ? 409 : 404);
    console.error("aa audio link", e);
    return json({ error: "Couldn't attach the audio. Nothing was saved." }, 502);
  }
}

/** GET ?meetingId: the owner's own transcript, as plain text. */
export async function downloadTranscript(req: Request, store: Store) {
  const denied = guard(req, store, false); if (denied) return denied;
  try {
    const data = await readMeetings(store);
    const a = data.meetings.find((m) => m.id === new URL(req.url).searchParams.get("meetingId"))?.audio;
    if (!a?.hasTranscript) return json({ error: "No transcript." }, 404);
    const f = await store.getFile(transcriptKey(a.id));
    if (!f) return json({ error: "No transcript." }, 404);
    return new Response(new Uint8Array(f.data), { headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch (e) { console.error("aa transcript", e); return json({ error: "Couldn't load the transcript." }, 502); }
}

/**
 * GET ?from&through&format=pdf|csv|json|backup[&kinds=AA,IOP][&topics=1][&notes=1]
 * pdf/csv/json: the court report rows. backup: the whole tracker as JSON (no file bytes).
 */
export async function downloadReport(req: Request, store: Store, now = new Date()) {
  const denied = guard(req, store, false); if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const format = q.get("format") ?? "pdf";
  if (!["pdf", "csv", "json", "backup"].includes(format)) return json({ error: "Choose PDF, CSV or JSON." }, 400);
  let doc: { rev: number; data: unknown } | null;
  try { doc = await store.readDoc(DOC_KEY); }
  catch (e) { console.error("aa report load", e); return json({ error: "Couldn't load meetings. Please try again." }, 502); }
  const data = normalize(doc?.data);
  const stamp = now.toISOString().slice(0, 10);
  const file = (body: BodyInit, type: string, name: string) => new Response(body, { headers: { ...NO_STORE, "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "X-Content-Type-Options": "nosniff" } });
  if (format === "backup") return file(JSON.stringify({ exportedAt: now.toISOString(), rev: doc?.rev ?? 0, attachmentBytesIncluded: false, ...data }, null, 2), "application/json", `aa-meetings-backup-${stamp}.json`);
  const options = parseOptions(q);
  let report: Report;
  try { report = buildReport(data, doc?.rev ?? 0, options, now); }
  catch (e) { return json({ error: (e as Error).message }, 400); }
  const base = `aa-attendance-${options.from}-to-${options.through}`;
  if (format === "csv") return file(reportCsv(report), "text/csv; charset=utf-8", `${base}.csv`);
  if (format === "json") return file(JSON.stringify(report, null, 2), "application/json", `${base}.json`);
  try { return file(new Uint8Array(await reportPdf(report)), "application/pdf", `${base}.pdf`); }
  catch (e) {
    if (e instanceof ReportError) return json({ error: e.message }, 400);
    console.error("aa report pdf", e); return json({ error: "Couldn't build the PDF. Please try again." }, 500);
  }
}
