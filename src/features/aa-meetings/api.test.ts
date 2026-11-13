import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { sessionToken } from "@/lib/auth";
import { downloadEvidence, downloadReport, getMeetings, postMeetings, uploadEvidence } from "./api";
import { DOC_KEY, type Store } from "./server";

// Synthetic credentials (read at call time) and an in-memory stand-in for the private database.
process.env.APP_PASSWORD = "synthetic-aa-meetings-test-only";
delete process.env.MFA_REQUIRED;

function memoryStore() {
  const docs = new Map<string, { rev: number; data: unknown }>();
  const files = new Map<string, { contentType: string; data: Buffer }>();
  const store: Store & { files: typeof files; docs: typeof docs } = {
    docs, files, configured: () => true,
    readDoc: async (k) => structuredClone(docs.get(k) ?? null),
    writeDoc: async (k, base, data) => {
      const cur = docs.get(k)?.rev ?? 0;
      if (cur !== base) return { ok: false, current: docs.get(k)! };
      docs.set(k, { rev: cur + 1, data: structuredClone(data) }); return { ok: true, rev: cur + 1 };
    },
    putFile: async (id, contentType, data) => { files.set(id, { contentType, data: Buffer.from(data) }); },
    getFile: async (id) => files.get(id) ?? null,
    deleteFile: async (id) => { files.delete(id); },
  };
  return store;
}

const base = "https://maverick.test";
const owner = `mp_session=${sessionToken("full")}`;
const req = (path: string, { cookie = owner, origin = base, body, type = "application/json", method }: { cookie?: string; origin?: string | null; body?: unknown; type?: string; method?: string } = {}) =>
  new Request(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(body === undefined ? {} : { "content-type": type }) },
    body: body === undefined ? undefined : body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : JSON.stringify(body),
  });
const now = new Date("2026-11-12T23:00:00Z"); // 6 PM Eastern
const post = async (s: Store, body: unknown, at = now) => { const r = await postMeetings(req("/api/aa-meetings", { body }), s, at); return { status: r.status, json: await r.json() }; };

test("every endpoint requires the owner's full session, and writes require this site's origin", async () => {
  const s = memoryStore();
  for (const cookie of ["", "mp_session=forged", `mp_session=${sessionToken("password")}`]) {
    process.env.MFA_REQUIRED = "1";
    assert.equal((await getMeetings(req("/api/aa-meetings", { cookie }), s)).status, 401);
    assert.equal((await postMeetings(req("/api/aa-meetings", { cookie, body: { action: "plan" } }), s)).status, 401);
    assert.equal((await uploadEvidence(req("/api/aa-meetings/evidence?meetingId=x", { cookie, body: new Uint8Array([1]) }), s)).status, 401);
    assert.equal((await downloadEvidence(req("/x", { cookie }), s, "00000000-0000-0000-0000-000000000000")).status, 401);
    assert.equal((await downloadReport(req("/api/aa-meetings/report?format=backup", { cookie }), s)).status, 401);
    delete process.env.MFA_REQUIRED;
  }
  assert.equal((await postMeetings(req("/api/aa-meetings", { origin: "https://attacker.example", body: { action: "plan" } }), s)).status, 403);
  assert.equal((await uploadEvidence(req("/api/aa-meetings/evidence?meetingId=x", { origin: "https://attacker.example", body: new Uint8Array([1]) }), s)).status, 403);
  assert.equal(s.docs.size, 0, "nothing was written");
  const off = { ...s, configured: () => false };
  assert.equal((await getMeetings(req("/api/aa-meetings"), off)).status, 503);
});

test("requests are validated and failures are reported, never shown as saved", async () => {
  const s = memoryStore();
  assert.equal((await postMeetings(new Request(base + "/api/aa-meetings", { method: "POST", headers: { cookie: owner, origin: base }, body: "{not json" }), s)).status, 400);
  assert.equal((await post(s, { action: "nope", id: "x" })).status, 400);
  assert.match((await post(s, { action: "add", date: "2026-13-01", name: "x" })).json.error, /valid meeting date/);
  assert.match((await post(s, { action: "add", date: "2026-11-01", name: "" })).json.error, /meeting name/);
  const broken = { ...s, writeDoc: async () => { throw new Error("db down"); } } as Store;
  const r = await post(broken, { action: "add", date: "2026-11-01", name: "Step" });
  assert.equal(r.status, 502); assert.match(r.json.error, /Nothing was changed/); assert.equal(r.json.data, undefined);
  const busy = { ...s, writeDoc: async () => ({ ok: false as const, current: { rev: 9, data: null } }) } as Store;
  assert.match((await post(busy, { action: "add", date: "2026-11-01", name: "Step" })).json.error, /Another device/);
});

test("planned versus attended through the API, with persisted edits and history", async () => {
  const s = memoryStore();
  const plan = await post(s, { action: "plan" });
  assert.equal(plan.status, 200); assert.ok(plan.json.added >= 12);
  assert.ok(plan.json.data.meetings.every((m: { state: string }) => m.state === "scheduled"));
  const rev = s.docs.get(DOC_KEY)!.rev;
  assert.equal((await post(s, { action: "plan" })).json.saved, false, "re-planning writes nothing");
  assert.equal(s.docs.get(DOC_KEY)!.rev, rev);

  const future = plan.json.data.meetings.find((m: { date: string }) => m.date > "2026-11-12");
  const r = await post(s, { action: "status", id: future.id, state: "attended" });
  assert.equal(r.status, 400); assert.match(r.json.error, /future/);

  const added = await post(s, { action: "add", date: "2026-11-11", time: "19:00", name: "Wednesday Step", topic: "What was the first thing you did when you felt tempted in your early days of recovery?" });
  const m = added.json.data.meetings.find((x: { name: string }) => x.name === "Wednesday Step");
  assert.equal((await post(s, { action: "add", date: "2026-11-11", time: "19:00", name: "wednesday step" })).json.error, "That meeting is already in your tracker.");
  await post(s, { action: "status", id: m.id, state: "attended" });
  await post(s, { action: "edit", id: m.id, date: "2026-11-11", time: "19:00", name: "Wednesday Step", minutes: 60, location: "Church hall" }, new Date("2026-11-13T01:00:00Z"));
  const saved = (await (await getMeetings(req("/api/aa-meetings"), s)).json()).meetings.find((x: { id: string }) => x.id === m.id);
  assert.equal(saved.state, "attended"); assert.equal(saved.minutes, 60); assert.equal(saved.location, "Church hall");
  assert.deepEqual(saved.history.map((h: { action: string }) => h.action.split(":")[0].split(" ").slice(0, 2).join(" ")), ["Added by", "Owner confirmed", "Owner edited"]);
  assert.equal(saved.history[2].at, "2026-11-13T01:00:00.000Z");
});

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("synthetic jpeg body")]);
const pdf = Buffer.from("%PDF-1.4\nsynthetic\n%%EOF");

test("supporting records: type and size checks, immutable bytes, hash-checked authenticated download", async () => {
  const s = memoryStore();
  const add = await post(s, { action: "add", date: "2026-11-10", time: "19:00", name: "Eldersburg Tuesday Night" });
  const id = add.json.data.meetings[0].id;
  const up = (body: Uint8Array, type: string, q = `meetingId=${id}&name=slip.jpg`) => uploadEvidence(req(`/api/aa-meetings/evidence?${q}`, { body, type }), s, now);

  assert.equal((await up(Buffer.from("<html>not a photo</html>"), "image/jpeg")).status, 415);
  assert.equal((await up(pdf, "image/jpeg")).status, 415, "declared type must match the bytes");
  assert.equal((await up(Buffer.alloc(0), "image/jpeg")).status, 400);
  assert.equal((await up(Buffer.concat([jpeg, Buffer.alloc(4 * 1024 * 1024)]), "image/jpeg")).status, 413);
  assert.equal((await up(jpeg, "image/jpeg", "meetingId=missing&name=a.jpg")).status, 404);
  assert.equal(s.files.size, 0, "rejected uploads store nothing");

  const ok = await up(jpeg, "image/jpeg", `meetingId=${id}&name=${encodeURIComponent("../../Slip \"Nov 10\".png")}`);
  assert.equal(ok.status, 200);
  const { evidence, data } = await ok.json();
  assert.equal(evidence.sha256, createHash("sha256").update(jpeg).digest("hex"));
  assert.equal(evidence.name, "Slip Nov 10.jpg"); assert.equal(evidence.type, "image/jpeg");
  assert.equal(data.meetings[0].state, "scheduled", "a file never marks attendance");
  assert.match(data.meetings[0].history.at(-1).action, /Attendance answer unchanged/);

  const second = await (await up(pdf, "application/pdf", `meetingId=${id}&name=letter.pdf`)).json();
  assert.notEqual(second.evidence.id, evidence.id); assert.equal(s.files.size, 2);

  const dl = await downloadEvidence(req("/x"), s, evidence.id);
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), jpeg);
  assert.equal(dl.headers.get("x-content-sha256"), evidence.sha256);
  assert.equal(dl.headers.get("x-content-type-options"), "nosniff");
  assert.match(dl.headers.get("content-disposition")!, /^attachment/);
  assert.equal((await downloadEvidence(req("/x", { cookie: "" }), s, evidence.id)).status, 401);
  assert.equal((await downloadEvidence(req("/x"), s, "../../etc")).status, 404);
  assert.equal((await downloadEvidence(req("/x"), s, "11111111-1111-1111-1111-111111111111")).status, 404, "only attached files are served");

  // Tampered bytes are refused rather than served as the original.
  s.files.get(`aa-evidence-${evidence.id}`)!.data = Buffer.from("changed");
  assert.equal((await downloadEvidence(req("/x"), s, evidence.id)).status, 409);

  // Withdrawing keeps the file and its record, only hiding it from reports.
  const w = await post(s, { action: "withdraw-evidence", id, evidenceId: second.evidence.id });
  assert.ok(w.json.data.meetings[0].evidence[1].withdrawnAt); assert.equal(s.files.size, 2);
});

test("an upload whose meeting save fails leaves no orphan file", async () => {
  const s = memoryStore();
  const id = (await post(s, { action: "add", date: "2026-11-10", name: "Step" })).json.data.meetings[0].id;
  const failing = { ...s, writeDoc: async () => { throw new Error("db down"); } } as Store;
  const r = await uploadEvidence(req(`/api/aa-meetings/evidence?meetingId=${id}&name=a.jpg`, { body: jpeg, type: "image/jpeg" }), failing, now);
  assert.equal(r.status, 502); assert.equal(s.files.size, 0);
});

test("report downloads include only confirmed rows and keep notes out by default", async () => {
  const s = memoryStore();
  await post(s, { action: "settings", name: "Sample Owner", court: "Sample Court", caseNumbers: "TEST-0001" });
  const add = async (date: string, name: string, extra = {}) => (await post(s, { action: "add", date, name, ...extra })).json.data.meetings.find((m: { date: string; name: string }) => m.date === date && m.name === name).id;
  const a = await add("2026-11-08", "Right Turn Alumni", { note: "PRIVATE NOTE", minutes: 60 });
  await add("2026-11-09", "Only planned");
  const c = await add("2026-11-10", "Eldersburg Tuesday Night", { minutes: 90 });
  await post(s, { action: "status", id: a, state: "attended" });
  await post(s, { action: "status", id: c, state: "attended" });
  await uploadEvidence(req(`/api/aa-meetings/evidence?meetingId=${c}&name=slip.jpg`, { body: jpeg, type: "image/jpeg" }), s, now);

  const json = await (await downloadReport(req("/api/aa-meetings/report?from=2026-11-01&through=2026-11-30&format=json"), s, now)).json();
  assert.deepEqual(json.rows.map((r: { name: string }) => r.name), ["Right Turn Alumni", "Eldersburg Tuesday Night"]);
  assert.deepEqual(json.totals, { meetings: 2, minutes: 150, withoutDuration: 0, withRecords: 1, withOrganizerEmail: 0, selfReportedOnly: 1 });
  assert.equal(json.rows[1].records[0].sha256, createHash("sha256").update(jpeg).digest("hex"));
  assert.doesNotMatch(JSON.stringify(json), /PRIVATE NOTE/);
  assert.match(JSON.stringify(await (await downloadReport(req("/api/aa-meetings/report?from=2026-11-01&through=2026-11-30&format=json&notes=1"), s, now)).json()), /PRIVATE NOTE/);

  const pdfRes = await downloadReport(req("/api/aa-meetings/report?from=2026-11-01&through=2026-11-30&format=pdf"), s, now);
  assert.equal(pdfRes.status, 200); assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  assert.equal((await downloadReport(req("/api/aa-meetings/report?from=2026-12-01&through=2026-12-31&format=pdf"), s, now)).status, 400);
  assert.equal((await downloadReport(req("/api/aa-meetings/report?from=bad&through=2026-12-31&format=csv"), s, now)).status, 400);
  const backup = await (await downloadReport(req("/api/aa-meetings/report?format=backup"), s, now)).json();
  assert.equal(backup.attachmentBytesIncluded, false); assert.equal(backup.meetings.length, 3);
});
