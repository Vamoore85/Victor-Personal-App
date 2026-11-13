import { createHash, randomUUID } from "node:crypto";
import { sameOrigin, signedIn } from "@/lib/plaid-server";
import {
  addDays, appendMeetings, applyCancellations, cancel, createMeeting, easternToday, edit, plannedMeetings, ruleInput, syncPlans, transition,
  normalize, type Attendance, type Evidence, type MeetingData,
} from "./model";
import { calendarCancellations, importCalendar } from "./calendar";
import { MAX_EVIDENCE_BYTES, MAX_FILES_PER_MEETING, fileKey, safeName, sniffType } from "./evidence";
import { ReportError, buildReport, parseOptions, reportCsv, reportPdf, type Report } from "./report";
import { DOC_KEY, TooLarge, boundedBody, readMeetings, updateMeetings, type Store } from "./server";

/*
 * Request handlers for the tracker, written against a Store so tests can run
 * them with real Requests and an in-memory database. Every handler needs the
 * owner's full session; every write also needs a same-origin request.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

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

class UserError extends Error {}
const fail = (message: string): never => { throw new UserError(message); };

export async function postMeetings(req: Request, store: Store, now = new Date()) {
  const denied = guard(req, store, true); if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse((await boundedBody(req, 2 * 1024 * 1024)).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch { return json({ error: "Use a valid request under 2 MB." }, 400); }
  const at = now.toISOString();
  let added = 0, updated = 0, cancelled = 0;
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
        default: fail("Unknown action.");
      }
      return next === m ? d : { ...d, meetings: d.meetings.map((x) => (x.id === m.id ? next : x)) };
    });
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
  const denied = guard(req, store, false); if (denied) return denied;
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: "Not found." }, 404);
  try {
    const data = await readMeetings(store);
    const record = data.meetings.flatMap((m) => m.evidence).find((e) => e.id === id);
    if (!record) return json({ error: "Not found." }, 404);
    const file = await store.getFile(fileKey(id));
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
