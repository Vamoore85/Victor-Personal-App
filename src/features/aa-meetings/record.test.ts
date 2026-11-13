import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { createMeeting, EMPTY, transition } from "./model";
import { meetingRecord } from "./record-fields";
import { recordDocx, recordPdf } from "./record";

// Synthetic data only.
const at = "2026-11-13T04:35:00Z";
const meeting = (extra = {}) => transition(createMeeting({ date: "2026-11-12", time: "20:00", name: "Sample Group Zoom", format: "online", location: "Zoom", topic: "Sample topic", takeaway: "One. Two. Three. Four.", note: "PRIVATE NOTE", ...extra }, "m1", at), "attended", at);
const data = { profile: { ...EMPTY.profile, name: "Sample Owner" } };

test("a meeting record shows the meeting, attendance, organizer status and takeaway, never private notes", () => {
  const r = meetingRecord(meeting(), data);
  assert.deepEqual(Object.fromEntries(r.rows), {
    Meeting: "Sample Group Zoom (online, Zoom)", Date: "Thursday, November 12, 2026", "Start time": "8:00 PM Eastern", Topic: "Sample topic",
    Attendee: "Sample Owner", Attendance: "Online", "Organizer confirmation": "Pending (email from the meeting organizer not yet received)",
  });
  assert.equal(r.takeaway, "One. Two. Three. Four.");
  assert.equal(r.fileBase, "2026-11-12 8 PM - Sample Group Zoom");
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|as reported|self-reported|Generated|Source/i);
  const link = meetingRecord(meeting({ location: "https://zoom.us/j/1?pwd=SECRET" }), data);
  assert.match(link.rows[0][1], /link withheld/); assert.doesNotMatch(JSON.stringify(link), /SECRET/);
  const m = meeting({ takeaway: "" }); m.audio = { takeaway: "From the Mac." } as never;
  assert.equal(meetingRecord(m, data).takeaway, "From the Mac.", "the Mac's audio takeaway fills a blank one");
  m.confirmations = [{ gmailId: "g", subject: "s", sender: "x", date: "2026-11-13T15:00:00Z", body: "", attachments: [], skippedAttachments: [], importedAt: at }];
  assert.equal(Object.fromEntries(meetingRecord(m, data).rows)["Organizer confirmation"], "Received November 13, 2026");
  assert.equal(Object.fromEntries(meetingRecord(meeting({ format: "in-person", location: "Church hall" }), data).rows).Attendance, "In person");
});

test("the record is a real one-page PDF and a Word document with the same text", async () => {
  const r = meetingRecord(meeting(), data);
  const pdf = await PDFDocument.load(await recordPdf(r));
  assert.equal(pdf.getPageCount(), 1);
  const zip = await recordDocx(r);
  // Read word/document.xml back out of the ZIP.
  const at = zip.indexOf("word/document.xml") - 30;
  assert.equal(zip.readUInt32LE(at), 0x04034b50);
  const method = zip.readUInt16LE(at + 8), size = zip.readUInt32LE(at + 18), nameLen = zip.readUInt16LE(at + 26), extra = zip.readUInt16LE(at + 28);
  const raw = zip.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
  const xml = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
  for (const s of ["AA Meeting Record", "Sample Group Zoom (online, Zoom)", "8:00 PM Eastern", "Online", "One. Two. Three. Four."]) assert.ok(xml.includes(s), s);
  assert.ok(!xml.includes("PRIVATE"));
});
