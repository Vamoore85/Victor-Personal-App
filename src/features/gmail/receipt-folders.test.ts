import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptFolders, receiptYear, receiptCsv, safeReceiptName } from "./receipt-folders";
import type { EmailItem } from "./parse";
import { receiptZip } from "@/lib/receipt-zip";
import { GET } from "@/app/api/gmail/receipts/[id]/route";

const email = (change: Partial<EmailItem> = {}): EmailItem => ({ id: "a123", kind: "receipt", merchant: "Example Shop", fromDomain: "example.test", subject: "Receipt", amount: 12, currency: "USD", billDate: "2025-12-31", dueDate: null, emailDate: "2026-01-02", evidence: "Paid $12", flags: [], status: "confirmed", scope: "personal", foundAt: "2026-01-02", ...change });

test("files by actual receipt year rather than email arrival, keeping companies separate", () => {
  const rows = receiptFolders([email(), email({ id: "a124", scope: "gladiator" }), email({ id: "a125", scope: "business" })], []);
  assert.deepEqual(rows.map(r => r.scope).sort(), ["business", "gladiator", "personal"]);
  assert.ok(rows.every(r => receiptYear(r.date) === "2025" && !r.reason));
});

test("unpaid bills, ignored items and repeats stay outside receipt folders", () => {
  assert.equal(receiptFolders([email({ kind: "bill" }), email({ status: "ignored" }), email({ status: "duplicate" })], []).length, 0);
});

test("suggestions, missing dates and missing companies stay in review; no guessed Personal", () => {
  const rows = receiptFolders([email({ status: "review" }), email({ id: "a124", billDate: null }), email({ id: "a125", scope: undefined })], []);
  assert.ok(rows.every(r => r.reason));
  assert.equal(rows.find(r => r.id === "a125")?.scope, undefined);
});

test("deduplicates by stable source ID, retaining distinct same-price purchases", () => {
  assert.equal(receiptFolders([email(), email(), email({ id: "b123" })], []).length, 2);
});

test("rejects impossible dates and unsafe ZIP paths; neutralizes spreadsheet formulas", () => {
  assert.equal(receiptYear("2026-02-30"), null);
  assert.equal(receiptYear("not recorded"), null);
  assert.equal(receiptYear("2024-02-29"), "2024");
  assert.ok(!safeReceiptName("../../bad/name").includes(".."));
  assert.match(receiptCsv(receiptFolders([email({ merchant: "=EVIL()" })], [])), /'=EVIL/);
  assert.throws(() => receiptZip([{ name: "../escape", bytes: new Uint8Array() }]), /Invalid/);
  assert.throws(() => receiptZip([{ name: "a", bytes: new Uint8Array() }, { name: "a", bytes: new Uint8Array() }]), /Duplicate/);
});

test("ZIP stores original bytes unchanged with UTF-8 paths and a central directory", () => {
  const content = new TextEncoder().encode("Original receipt\r\nTotal: $12.00");
  const zip = receiptZip([{ name: "2025/Personal/café.eml", bytes: content }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const length = view.getUint16(26, true);
  assert.deepEqual(zip.slice(30 + length, 30 + length + content.length), content);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(zip.length - 12, true), 1);
});

test("original receipt endpoint rejects unsigned and cross-origin requests before accessing mail", async () => {
  const ctx = { params: Promise.resolve({ id: "a123" }) };
  assert.equal((await GET(new Request("https://example.test/api/gmail/receipts/a123"), ctx)).status, 401);
  assert.equal((await GET(new Request("https://example.test/api/gmail/receipts/a123", { headers: { origin: "https://other.test" } }), ctx)).status, 403);
});
