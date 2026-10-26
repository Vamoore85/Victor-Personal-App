import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { buildFolders, indexCsv, originalName, years } from "./folders";
import { crc32, zipBuffer } from "@/lib/zip";
import type { EmailItem } from "@/features/gmail/parse";
import type { Receipt } from "@/features/money/types";

const email = (id: string, over: Partial<EmailItem> = {}): EmailItem => ({
  id, kind: "receipt", merchant: "Verizon", fromDomain: "verizon.com", subject: "Your payment", amount: 120, currency: "USD",
  billDate: null, dueDate: null, emailDate: "2026-10-20", evidence: "Amount paid $120.00", flags: [], status: "review", foundAt: "now", ...over,
});
const upload = (id: string, over: Partial<Receipt> = {}): Receipt => ({
  id, date: "2025-03-02", merchant: "Home Depot", amount: 80.5, note: "", scope: "business", contentType: "image/jpeg", size: 10, addedAt: "now", ...over,
});

test("confirmed emails go to their company; anything uncertain goes to Needs review", () => {
  const all = buildFolders({ receipts: [] }, [
    email("a", { status: "confirmed", scope: "gladiator" }),
    email("b", { status: "review", scope: "business" }), // suggested company, not confirmed
    email("c", { status: "confirmed" }), // confirmed with no company
    email("d", { status: "ignored", scope: "personal" }),
    email("e", { status: "duplicate", duplicateOf: "a" }),
  ]);
  assert.deepEqual(all.map((e) => [e.key, e.section]), [["email-a", "gladiator"], ["email-b", "review"], ["email-c", "review"]]);
  assert.equal(all.find((e) => e.key === "email-b")!.scope, "business");
});

test("uploaded receipts file by their company and year; no company or no amount needs review", () => {
  const all = buildFolders({ receipts: [upload("r1"), upload("r2", { scope: undefined }), upload("r3", { amount: null, date: "2026-01-05" })] }, []);
  assert.deepEqual(all.map((e) => [e.key, e.year, e.section]), [["upload-r3", "2026", "review"], ["upload-r1", "2025", "business"], ["upload-r2", "2025", "review"]]);
});

test("an email is filed by its bill date when it states one", () => {
  const [e] = buildFolders({ receipts: [] }, [email("a", { billDate: "2025-12-30", emailDate: "2026-01-02", status: "confirmed", scope: "personal" })]);
  assert.equal(e.year, "2025");
  assert.equal(originalName(e), "2025/Personal/2025-12-30 Verizon 120.00.eml");
});

test("filing never changes the source items", () => {
  const items = [email("a", { status: "confirmed", scope: "personal" })];
  const before = JSON.stringify(items);
  buildFolders({ receipts: [] }, items);
  assert.equal(JSON.stringify(items), before);
});

test("year totals per folder", () => {
  const y = years(buildFolders({ receipts: [upload("r1"), upload("r2", { amount: 19.5 })] }, [email("a")]));
  assert.deepEqual(y.map((x) => x.year), ["2026", "2025"]);
  assert.deepEqual(y[1].sections.business, { count: 2, total: 100 });
  assert.deepEqual(y[0].sections.review, { count: 1, total: 120 });
});

test("index.csv quotes commas and defuses spreadsheet formulas", () => {
  const [e] = buildFolders({ receipts: [] }, [email("a", { merchant: "=HYPERLINK(1)", subject: "Hi, there" })]);
  const csv = indexCsv([{ e, file: "x.eml" }]);
  assert.match(csv, /'=HYPERLINK\(1\)/);
  assert.match(csv, /"Hi, there"/);
});

/** Reads a ZIP's entries back, to check the writer. */
function unzip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const packed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const body = buf.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, name);
    out[name] = data;
    p += 46 + nameLen;
  }
  return out;
}

test("the ZIP holds each original byte for byte, and gives repeated names a number", async () => {
  const eml = Buffer.from("From: a@b.com\r\nSubject: Receipt\r\n\r\nAmount paid $1.00\r\n".repeat(20));
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const files = unzip(await zipBuffer([
    { name: "2026/Personal/a.eml", data: eml },
    { name: "2026/Personal/a.eml", data: jpg },
    { name: "2026/Gladiator/ü.jpg", data: jpg },
  ]));
  assert.deepEqual(Object.keys(files), ["2026/Personal/a.eml", "2026/Personal/a (2).eml", "2026/Gladiator/ü.jpg"]);
  assert.ok(files["2026/Personal/a.eml"].equals(eml));
  assert.ok(files["2026/Gladiator/ü.jpg"].equals(jpg));
});

test("a scan you haven't checked stays in Needs review until you check it", () => {
  const [e] = buildFolders({ receipts: [upload("s1", { unchecked: true })] }, []);
  assert.equal(e.section, "review");
  assert.equal(e.why, "Scanned; you haven't checked what was read yet.");
  const [done] = buildFolders({ receipts: [upload("s1", { unchecked: false })] }, []);
  assert.equal(done.section, "business");
});
