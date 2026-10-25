import { test } from "node:test";
import assert from "node:assert/strict";
import { lastPayments, linkSiteCosts, proposeLinks, siteCost } from "./site-costs";
import { EMPTY_DATA, type Bill, type Institution, type MoneyData } from "./types";

// Made-up sites and bills (no real names or amounts).
const site = (id: string, name: string, website: string, scope: Institution["scope"], extra: Partial<Institution> = {}): Institution => ({
  id, name, type: "Website", website, loginUrl: "", phone: "", memberNumber: "", notes: "", scope, ...extra,
});
const bill = (id: string, name: string, url: string, scope: Bill["scope"], extra: Partial<Bill> = {}): Bill => ({
  id, name, amount: 10, category: "x", frequency: "monthly", nextDue: "2026-11-01", dueDay: 1, accountId: "", autopay: true, url, scope, ...extra,
});

const data: MoneyData = {
  ...EMPTY_DATA,
  institutions: [
    site("s1", "Video Co Streaming", "https://video.example", "business"),
    site("s2", "Payroll Co Fees", "https://payroll.example", "gladiator"),
    site("s3", "Payroll Co Taxes", "https://payroll.example", "gladiator"),
    site("s4", "Debt Plan A", "https://debt.example", "gladiator"),
    site("s5", "Debt Plan B", "https://debt.example", "gladiator"),
    site("s6", "Video Co Streaming", "https://video.example", "personal"),
    site("s7", "Chatbotter Assistant", "https://bots.example", "business"),
  ],
  bills: [
    bill("b1", "Video Co", "https://video.example", "business"),
    bill("b2", "Payroll Co fees", "https://payroll.example", "gladiator"),
    bill("b3", "Debt Plan", "https://debt.example", "gladiator"), // fits A and B equally
    bill("b4", "Chatbotter", "https://chatbotter.example", "business"), // different address, long shared word
    bill("b5", "Gym", "", "personal"),
  ],
};

test("links a bill only to the one site in its company it clearly fits", () => {
  const links = new Map(proposeLinks(data));
  assert.equal(links.get("b1"), "s1"); // not the personal copy of the site
  assert.equal(links.get("b2"), "s2");
  assert.equal(links.has("b3"), false); // tied between two sites: left for you
  assert.equal(links.get("b4"), "s7");
  assert.equal(links.has("b5"), false);
  assert.equal(links.size, 3);
});

test("matching runs once and never changes a bill's amount or schedule", () => {
  const r = linkSiteCosts(data)!;
  assert.equal(r.linked, 3);
  const b1 = r.data.bills.find((b) => b.id === "b1")!;
  assert.deepEqual([b1.institutionId, b1.amount, b1.nextDue, b1.frequency], ["s1", 10, "2026-11-01", "monthly"]);
  assert.equal(linkSiteCosts(r.data), null);
});

test("sites with a cost you set are left alone", () => {
  const set = { ...data, institutions: data.institutions.map((s) => (s.id === "s1" ? { ...s, cost: { kind: "variable" as const } } : s)) };
  assert.equal(new Map(proposeLinks(set)).has("b1"), false);
});

test("shows yearly bills as a monthly amount, and unknown as not set", () => {
  const s = data.institutions[0];
  assert.deepEqual(siteCost(s, []), { state: "unset" });
  const yearly = siteCost(s, [bill("y", "Video Co", "", "business", { amount: 120, frequency: "yearly", institutionId: "s1" })]);
  assert.equal(yearly.state === "bills" && yearly.monthly, 10);
  assert.equal(yearly.state === "bills" && yearly.yearly, true);
  const typed = siteCost({ ...s, cost: { kind: "manual", amount: 60, period: "yearly" } }, []);
  assert.deepEqual(typed, { state: "manual", monthly: 5, yearly: 60 });
  assert.deepEqual(siteCost({ ...s, cost: { kind: "variable" } }, []), { state: "variable" });
});

test("finds the latest posted payment per site, in the same company, and skips ambiguous ones", () => {
  const acct = (id: string, scope: Institution["scope"]) => ({ id, name: id, type: "checking" as const, openingBalance: 0, scope });
  const txn = (id: string, date: string, description: string, amount: number, accountId: string, extra = {}) => ({
    id, date, description, amount, kind: "expense" as const, category: "x", accountId, ...extra,
  });
  const d = {
    institutions: [
      site("s1", "Video Co Streaming", "https://videoco.example", "business"),
      site("s2", "Payroll Co Fees", "https://payco.example", "gladiator"),
      site("s3", "Payroll Co Taxes", "https://payco.example", "gladiator"),
      site("s4", "Video Co Streaming", "https://videoco.example", "personal"),
    ],
    bills: [bill("b3", "Payroll Co taxes", "", "gladiator", { amount: 250, institutionId: "s3" })],
    accounts: [acct("biz", "business"), acct("glad", "gladiator"), acct("pers", "personal")],
    transactions: [
      txn("t1", "2026-09-28", "VIDEOCO*STREAM 800-555", 15.49, "biz"),
      txn("t2", "2026-10-28", "VIDEOCO*STREAM 800-555", 15.49, "biz"),
      txn("t2b", "2026-10-29", "VIDEOCO STORE", 89.99, "biz"), // a one-off purchase, not the bill
      txn("t3", "2026-10-30", "VIDEOCO refund", 15.49, "biz", { kind: "income" }), // money in, not a payment
      txn("t4", "2026-10-02", "PAYCO PAYROLL", 1200, "glad"), // fits both payroll sites, no exact bill: nobody
      txn("t5", "2026-10-03", "PAYCO TAX", 250, "glad"), // exact amount of s3's bill
      txn("t6", "2026-10-05", "PAYCO TAX", 250, "glad", { transferId: "x" }), // a transfer, not a bill
    ],
  };
  const paid = lastPayments(d);
  assert.deepEqual(paid.get("s1"), { date: "2026-10-28", amount: 15.49, accountId: "biz" });
  assert.equal(paid.has("s4"), false); // the personal copy never saw a personal payment
  assert.equal(paid.has("s2"), false);
  assert.deepEqual(paid.get("s3"), { date: "2026-10-03", amount: 250, accountId: "glad" });
});
