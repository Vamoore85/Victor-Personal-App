import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFRawStream } from "pdf-lib";
import { buildReport, reportCsv, reportPdf, type ReportOptions } from "./report";
import { createMeeting, EMPTY, transition } from "./model";

// Synthetic data only.
const at = "2026-11-12T21:00:00Z";
const opts = (o: Partial<ReportOptions> = {}): ReportOptions => ({ from: "2026-11-01", through: "2026-11-12", kinds: ["AA"], includeTopics: false, includeNotes: false, ...o });
const sample = () => {
  const data = structuredClone(EMPTY); data.profile.name = "Sample User - Test Data";
  const attended = transition(createMeeting({ date: "2026-11-08", time: "18:00", minutes: 60, name: "Sunday Alumni", topic: "Sample topic", note: "PRIVATE JOURNAL SHOULD NOT BE EXPORTED", location: "https://zoom.us/example?pwd=PRIVATE_JOIN_SECRET" }, "sample-1", at), "attended", at);
  const planned = createMeeting({ date: "2026-11-10", name: "Planned but not confirmed" }, "sample-2", at);
  const missed = transition(createMeeting({ date: "2026-11-04", name: "Missed one" }, "sample-4", at), "missed", at);
  const iop = transition(createMeeting({ date: "2026-11-09", name: "Treatment IOP", kind: "IOP" }, "sample-3", at), "attended", at);
  const outside = transition(createMeeting({ date: "2026-10-31", name: "Before the range" }, "sample-5", at), "attended", at);
  data.meetings.push(attended, planned, missed, iop, outside); return data;
};
// pdf-lib writes standard-font text as hex strings inside compressed page streams.
async function pdfText(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string; try { s = inflateSync(obj.contents).toString("latin1"); } catch { s = Buffer.from(obj.contents).toString("latin1"); }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += Buffer.from(m[1], "hex").toString("latin1") + " ";
  }
  return out;
}

test("only explicitly confirmed AA attendance in range is reported, with totals", () => {
  const r = buildReport(sample(), 7, opts(), new Date(at));
  assert.deepEqual(r.rows.map((x) => x.name), ["Sunday Alumni"]);
  assert.equal(r.totals.meetings, 1); assert.equal(r.totals.minutes, 60); assert.equal(r.totals.selfReportedOnly, 1);
  assert.match(r.source, /revision 7/);
  assert.equal(buildReport(sample(), 7, opts({ kinds: ["AA", "IOP"] })).rows.length, 2);
});

test("CSV omits plans, IOP, private notes, topics and meeting links by default", () => {
  const text = reportCsv(buildReport(sample(), 1, opts()));
  assert.match(text, /Sunday Alumni/); assert.doesNotMatch(text, /Planned but not confirmed|Treatment IOP|Missed one|PRIVATE|Sample topic/);
  assert.match(text, /Online \(link withheld\)/);
  assert.equal(text.trim().split("\r\n").length, 2);
  const opted = reportCsv(buildReport(sample(), 1, opts({ includeTopics: true, includeNotes: true })));
  assert.match(opted, /Sample topic/); assert.match(opted, /PRIVATE JOURNAL/); assert.doesNotMatch(opted, /PRIVATE_JOIN_SECRET/);
});

test("CSV neutralizes spreadsheet formulas and excludes withdrawn records", () => {
  const data = sample(); data.meetings[0].name = "=HYPERLINK(\"https://example.com\")";
  data.meetings[0].evidence = [
    { id: "e1", name: "withdrawn.pdf", type: "application/pdf", size: 123, sha256: "a".repeat(64), uploadedAt: at, withdrawnAt: at },
    { id: "e2", name: "slip.jpg", type: "image/jpeg", size: 2048, sha256: "b".repeat(64), uploadedAt: at },
  ];
  const r = buildReport(data, 1, opts());
  const text = reportCsv(r);
  assert.match(text, /'=HYPERLINK/); assert.doesNotMatch(text, /withdrawn.pdf/); assert.match(text, /R1 slip.jpg b{64}/);
  assert.equal(r.rows[0].basis, "Self-reported; supporting record R1"); assert.equal(r.totals.withRecords, 1);
});

test("PDF is a real Letter document with the disclaimer, record hashes and no secrets", async () => {
  const data = sample();
  data.meetings[0].evidence = [{ id: "e2", name: "slip.jpg", type: "image/jpeg", size: 2048, sha256: "c".repeat(64), uploadedAt: at }];
  const bytes = await reportPdf(buildReport(data, 1, opts(), new Date(at)));
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  const text = await pdfText(bytes);
  assert.match(text, /Sample User - Test Data/); assert.match(text, /Self-reported/);
  // Victor asked for no statement paragraphs and no Generated/Source lines on the printed report.
  assert.doesNotMatch(text, /no signature, stamp or certification|not independent verification|Generated|Source|kept unchanged/);
  assert.match(text, /SHA-256 c{64}/);
  assert.doesNotMatch(text, /PRIVATE|Planned but not confirmed|Treatment IOP/);
});

test("PDF paginates long reports on Letter pages", async () => {
  const data = sample();
  data.meetings = Array.from({ length: 60 }, (_, i) => ({ ...data.meetings[0], id: `sample-${i}`, name: "A longer recovery meeting name with a readable multi-line title for a pagination check " + i }));
  const pdf = await PDFDocument.load(await reportPdf(buildReport(data, 1, opts())));
  assert.ok(pdf.getPageCount() > 1);
  for (const page of pdf.getPages()) assert.deepEqual(page.getSize(), { width: 612, height: 792 });
});

test("an empty report or a missing name cannot produce a misleading PDF", async () => {
  const empty = structuredClone(EMPTY); empty.profile.name = "Someone";
  await assert.rejects(() => reportPdf(buildReport(empty, 1, opts())), /No confirmed attendance/);
  const data = sample(); data.profile.name = "";
  await assert.rejects(() => reportPdf(buildReport(data, 1, opts())), /name/);
});

// Every piece of text must sit inside the printable area: above the footer and within the margins.
async function textPositions(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const out: { page: number; y: number; text: string }[] = [];
  pdf.getPages().forEach((page, i) => {
    const contents = page.node.Contents();
    const streams = contents && "asArray" in contents ? contents.asArray() : [contents];
    for (const ref of streams) {
      const obj = pdf.context.lookup(ref as never);
      if (!(obj instanceof PDFRawStream)) continue;
      const s = inflateSync(obj.contents).toString("latin1");
      for (const m of s.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]+)>\s*Tj/g)) out.push({ page: i, y: Number(m[2]), text: Buffer.from(m[3], "hex").toString("latin1") });
    }
  });
  return { pdf, out };
}

test("a maximum-length private note splits across pages instead of running past the footer", async () => {
  const data = sample();
  const note = Array.from({ length: 700 }, (_, i) => `word${i}`).join(" ").slice(0, 4000); // the full 4,000-character limit
  data.meetings[0].note = note; data.meetings[0].topic = "T".repeat(10) + " " + "topic ".repeat(45);
  data.profile.reportTitle = "A very long report title ".repeat(6).trim();
  data.profile.name = "Sample Owner With An Unusually Long Name ".repeat(3).trim();
  const { pdf, out } = await textPositions(await reportPdf(buildReport(data, 1, opts({ includeNotes: true, includeTopics: true }))));
  assert.ok(pdf.getPageCount() > 1, "the note continues on another page");
  const footer = out.filter((t) => t.y === 26);
  assert.equal(footer.filter((t) => /Page \d+ of \d+/.test(t.text)).length, pdf.getPageCount(), "every page shows its page count");
  for (const t of out.filter((t) => t.y !== 26)) assert.ok(t.y >= 60, `text above the footer: "${t.text.slice(0, 30)}" at y=${t.y}`);
  assert.match(out.map((t) => t.text).join(" "), /\(continued\)/);
  assert.match(out.map((t) => t.text).join(" "), new RegExp(note.split(" ").at(-1)!), "the whole note is printed");
});
