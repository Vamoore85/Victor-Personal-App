import { test } from "node:test";
import assert from "node:assert/strict";
import { amounts, extract, kindOf, mergeFound, messageText, pickAmount, readDate, sender, type EmailItem, type RawMessage } from "./parse";
import { suggestBill, suggestScope } from "./match";
import { applyReview, searchQuery } from "@/lib/gmail";
import type { Bill, Institution } from "@/features/money/types";

// Made-up senders, amounts and dates only.
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const msg = (id: string, from: string, subject: string, body: string, date = "2026-10-01", html = false): RawMessage => ({
  id,
  internalDate: String(Date.parse(`${date}T15:00:00Z`)),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "Subject", value: subject },
    ],
    parts: [
      { mimeType: html ? "text/html" : "text/plain", body: { data: b64(body) } },
      { mimeType: "application/pdf", filename: "statement.pdf", body: { size: 1000 } },
    ],
  },
});

test("reads a bill: amount due, due date and statement date the email states", () => {
  const item = extract(
    msg("m1", '"Example Power" <billing@email.examplepower.com>', "Your bill is ready", "Statement date: 09/28/2026\nAmount due: $123.45\nPayment due date: October 20, 2026\nCredit limit $5,000.00"),
    "now",
  )!;
  assert.equal(item.kind, "bill");
  assert.equal(item.merchant, "Example Power");
  assert.equal(item.fromDomain, "examplepower.com");
  assert.equal(item.amount, 123.45);
  assert.equal(item.currency, "USD");
  assert.equal(item.dueDate, "2026-10-20");
  assert.equal(item.billDate, "2026-09-28");
  assert.equal(item.emailDate, "2026-10-01");
  assert.equal(item.status, "review");
  assert.deepEqual(item.flags, []);
});

test("a payment confirmation is a receipt, never a bill with a due date", () => {
  const item = extract(
    msg("m2", "Streamy <no-reply@streamy.example>", "Thank you for your payment", "<p>We received your payment of <b>$15.49</b>.</p><p>Payment date: Oct 3, 2026</p>", "2026-10-03", true),
    "now",
  )!;
  assert.equal(item.kind, "receipt");
  assert.equal(item.amount, 15.49);
  assert.equal(item.dueDate, null);
  assert.equal(item.billDate, "2026-10-03");
});

test("skips mail that isn't a bill or receipt", () => {
  assert.equal(extract(msg("m3", "Shop <deals@shop.example>", "40% off everything this weekend", "Save $20.00 on your next order"), "now"), null);
  assert.equal(extract(msg("m4", "Friend <pal@mail.example>", "Dinner Friday?", "Want to split the $40 bill?"), "now"), null);
  assert.equal(extract(msg("m5", "Bank <alerts@bank.example>", "Your verification code", "Your code is 123456"), "now"), null);
});

test("flags amounts it isn't sure about", () => {
  const two = pickAmount("Total due: $50.00\nTotal due: $75.00");
  assert.equal(two.flags.length, 1);
  const bare = pickAmount("Your invoice\n$19.99");
  assert.match(bare.flags[0], /wasn't labeled/);
  const min = pickAmount("Minimum payment due: $35.00");
  assert.match(min.flags[0], /minimum/);
  assert.equal(pickAmount("no money here").amount, null);
  assert.deepEqual(amounts("You saved $10.00. Order total: $90.00").map((a) => a.amount), [90]);
});

test("reads dates only when stated, and flags a missing year", () => {
  assert.deepEqual(readDate("11/05/26 please", "2026-10-01"), { date: "2026-11-05", yearGuessed: false });
  assert.deepEqual(readDate("2026-12-01", "2026-10-01"), { date: "2026-12-01", yearGuessed: false });
  assert.deepEqual(readDate("Jan 3", "2026-12-20"), { date: "2027-01-03", yearGuessed: true });
  assert.equal(readDate("02/30/2026", "2026-10-01"), null);
  assert.equal(readDate("soon", "2026-10-01"), null);
  const item = extract(msg("m6", "Gym Co <billing@gymco.example>", "Payment reminder", "Amount due $40.00, due Nov 1"), "now")!;
  assert.equal(item.dueDate, "2026-11-01");
  assert.ok(item.flags.some((f) => /year/.test(f)));
});

test("names the sender from the display name or, for generic ones, the domain", () => {
  assert.deepEqual(sender("noreply@notify.water.example.co.uk"), { merchant: "Example", domain: "example.co.uk" });
  assert.equal(sender('"Billing" <billing@phoneco.example>').merchant, "Phoneco");
  assert.equal(sender("Phone Co via Pay Service <x@payservice.example>").merchant, "Phone Co");
});

test("plain text wins over HTML, and attachments are never read", () => {
  assert.equal(messageText(msg("x", "a@b.example", "s", "Amount due: $1.00").payload), "Amount due: $1.00");
  assert.equal(kindOf("Your statement is ready", ""), "bill");
});

const item = (id: string, extra: Partial<EmailItem> = {}): EmailItem => ({
  id, kind: "bill", merchant: "Example Power", fromDomain: "examplepower.com", subject: "Bill", amount: 100, currency: "USD",
  billDate: null, dueDate: "2026-10-20", emailDate: "2026-10-01", evidence: "", flags: [], status: "review", foundAt: "now", ...extra,
});

test("keeps one copy of a bill and never changes what you already decided", () => {
  const saved = [item("a", { status: "confirmed", scope: "gladiator" })];
  const r = mergeFound(saved, [item("a", { amount: 5 }), item("b", { emailDate: "2026-10-15" }), item("c", { dueDate: "2026-11-20", emailDate: "2026-11-01" })]);
  assert.equal(r.items.length, 3);
  assert.equal(r.items.find((i) => i.id === "a")!.amount, 100);
  assert.equal(r.items.find((i) => i.id === "b")!.status, "duplicate");
  assert.equal(r.items.find((i) => i.id === "b")!.duplicateOf, "a");
  assert.equal(r.items.find((i) => i.id === "c")!.status, "review");
  assert.deepEqual([r.added, r.duplicates], [1, 1]);
});

test("confirming needs a company; edits are checked", () => {
  const items = [item("a")];
  assert.throws(() => applyReview(items, { id: "a", status: "confirmed" }), /Pick Personal/);
  const ok = applyReview(items, { id: "a", status: "confirmed", scope: "business", amount: 99.999 });
  assert.deepEqual([ok[0].status, ok[0].scope, ok[0].amount], ["confirmed", "business", 100]);
  assert.throws(() => applyReview(items, { id: "a", dueDate: "10/20/2026" }), /YYYY/);
  assert.throws(() => applyReview(items, { id: "zzz", status: "ignored" }), /isn't in the list/);
});

test("the Gmail search is bounded to the range and skips chats, promotions and social mail", () => {
  const q = searchQuery("2026-07-28", "2026-10-25");
  assert.match(q, /^after:2026\/07\/28 before:2026\/10\/26 /);
  for (const part of ["-in:chats", "-category:promotions", "-category:social"]) assert.ok(q.includes(part));
});

const site = (id: string, name: string, website: string, scope: Institution["scope"]): Institution => ({
  id, name, type: "Website", website, loginUrl: "", phone: "", memberNumber: "", notes: "", scope,
});
const bill = (id: string, name: string, scope: Bill["scope"], url = ""): Bill => ({
  id, name, amount: 10, category: "x", frequency: "monthly", nextDue: "2026-11-01", dueDay: 1, accountId: "", autopay: false, url, scope,
});

test("suggests a company only when exactly one fits, and never assumes Personal", () => {
  const sites = [site("s1", "Example Power", "https://examplepower.com", "gladiator"), site("s2", "Streamy", "https://streamy.example", "personal"), site("s3", "Streamy", "https://streamy.example", "business")];
  assert.equal(suggestScope(item("a"), sites, []).scope, "gladiator");
  assert.equal(suggestScope(item("b", { merchant: "Streamy", fromDomain: "streamy.example" }), sites, []).scope, null);
  assert.equal(suggestScope(item("c", { merchant: "Unknown", fromDomain: "nobody.example" }), sites, []).scope, null);
  const bills = [bill("b1", "Example Power electric", "gladiator"), bill("b2", "Example Power", "personal")];
  assert.equal(suggestBill(item("a"), "gladiator", bills)?.id, "b1");
  assert.equal(suggestBill(item("a"), "business", bills), null);
});
