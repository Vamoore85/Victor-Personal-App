import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, isCalendarDate, reportCsv, reportText } from "./reports";
import { EMPTY_DATA, type MoneyData } from "./types";

const end = "2026-10-24";
const now = Date.parse(`${end}T12:00:00Z`);
function fixture(): MoneyData {
  return { ...EMPTY_DATA, accountRules: 4,
    accounts: [
      { id: "p", name: "Personal", type: "checking", openingBalance: 0, scope: "personal", bankBalance: { current: 500, available: 500, asOf: `${end}T11:00:00Z` } },
      { id: "m", name: "Business", type: "checking", openingBalance: 0, scope: "business" },
      { id: "u", name: "Unknown", type: "checking", openingBalance: 0, needsEntity: true },
    ],
    transactions: [
      { id: "a", date: "2026-02-01", description: "Store", category: "Shopping", amount: 20, kind: "expense", accountId: "p", plaidId: "txn" },
      { id: "b", date: "2026-02-02", description: "Transfer", category: "Other", amount: 100, kind: "expense", accountId: "p", transferId: "transfer" },
      { id: "c", date: "2026-02-03", description: "Company", category: "Other", amount: 90, kind: "expense", accountId: "m" },
      { id: "d", date: "2026-02-03", description: "Unassigned", category: "Other", amount: 90, kind: "expense", accountId: "u" },
      { id: "e", date: "2025-12-30", description: "Old", category: "Other", amount: 80, kind: "expense", accountId: "p" },
      { id: "f", date: "2026-10-25", description: "Future", category: "Other", amount: 80, kind: "expense", accountId: "p" },
    ],
    bills: [{ id: "bill", name: "Rent", amount: 100, category: "Housing", frequency: "monthly", nextDue: "2026-11-01", dueDay: 1, accountId: "p", autopay: false, scope: "personal" }],
  };
}

test("report isolates each entity and period, excluding transfers from totals", () => {
  const d = fixture();
  const original = JSON.stringify(d);
  const r = buildReport(d, "personal", "ytd", end, now);
  assert.equal(r.spent, 20);
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions.find((t) => t.merchant === "Transfer")?.transfer, true);
  assert.equal(r.confirmedBills, 100);
  assert.equal(r.projected, 400);
  assert.equal(r.coverage[0].first, "2025-12-30", "coverage reads the whole history, not just the period");
  assert.ok(!r.warnings.some((w) => w.includes("incomplete")), "history covers this period");
  assert.equal(buildReport(d, "business", "ytd", end, now).spent, 90);
  assert.equal(JSON.stringify(d), original, "report must not change saved data");
});

test("transfers, owner draws, card payments and refunds stay out of spending and income, as on the Spending screen", () => {
  const d = fixture();
  d.accounts.push({ id: "cc", name: "Card", type: "credit", openingBalance: 0, scope: "personal", last4: "9999" });
  d.transactions.push(
    { id: "t1", date: "2026-03-02", description: "XFER TO SAVINGS", category: "Transfer", amount: 300, kind: "expense", accountId: "p" },
    { id: "t2", date: "2026-03-03", description: "CAPITAL ONE CRD PMT", category: "Debt payments", amount: 400, kind: "expense", accountId: "p" },
    { id: "t3", date: "2026-03-04", description: "STORE PURCHASE", category: "Shopping", amount: 60, kind: "expense", accountId: "cc" },
    { id: "t4", date: "2026-03-05", description: "RETURN-STORE", category: "Shopping", amount: 40, kind: "income", accountId: "cc" },
    { id: "t5", date: "2026-03-06", description: "OWNER DRAW", category: "Owner draw", amount: 500, kind: "expense", accountId: "m" },
  );
  const personal = buildReport(d, "personal", "ytd", end, now);
  assert.equal(personal.spent, 80, "20 from February plus the 60 card purchase; transfer and card payment excluded");
  assert.equal(personal.refunds, 40, "refund shown on its own");
  assert.equal(personal.income, 0, "a card credit is not income");
  const business = buildReport(d, "business", "ytd", end, now);
  assert.equal(business.spent, 90, "owner draw is not spending");
  const csv = reportCsv(personal);
  assert.ok(csv.startsWith("\uFEFF"), "CSV starts with a byte-order mark");
  assert.ok(csv.includes('"Card payment (excluded)"'));
  assert.ok(reportText(personal).includes("Refunds (not netted): $40.00"));
});

test("past-due bills are included in the projection and flagged", () => {
  const d = fixture();
  d.bills[0].nextDue = "2026-10-20";
  d.bills[0].frequency = "yearly"; // so the only charge in the next 30 days is the past-due one
  const r = buildReport(d, "personal", "ytd", end, now);
  assert.equal(r.confirmedBills, 100);
  assert.equal(r.projected, 400);
  assert.ok(r.warnings.some((w) => w.includes("past due")));
  assert.equal(r.bills.length, 1);
});

test("a period that starts before the recorded history warns that totals may be incomplete", () => {
  const r = buildReport(fixture(), "business", "ytd", end, now);
  assert.equal(r.coverage[0].first, "2026-02-03");
  assert.ok(r.warnings.some((w) => w.includes("incomplete")));
});

test("the endpoint's end date must be a real calendar date", () => {
  assert.equal(isCalendarDate("2026-10-24"), true);
  assert.equal(isCalendarDate("2026-99-99"), false);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("not a date"), false);
});

test("the report's end date comes from the caller, so a late-evening local date is not skipped", () => {
  const r = buildReport(fixture(), "personal", "30d", "2026-10-24", now);
  assert.deepEqual(r.period, { start: "2026-09-25", end: "2026-10-24" });
});

test("empty history and absent balance remain explicit; exports contain no connection secrets", () => {
  const d = fixture();
  d.bankLinks = [{ id: "bank", itemId: "secret-item", institution: "Bank", link: "sealed-token", cursor: "private-cursor" }];
  const r = buildReport(d, "gladiator", "30d", end, now);
  assert.equal(r.available, null);
  assert.equal(r.projected, null);
  assert.ok(r.warnings.some((w) => w.includes("No transactions")));
  assert.ok(!JSON.stringify(r).includes("sealed-token"));
  assert.ok(!JSON.stringify(r).includes("private-cursor"));
  assert.match(reportText(r), /Unavailable/);
});

test("CSV quotes merchant text and neutralizes formulas; JSON retains exact original labels", () => {
  const d = fixture();
  d.transactions[0].description = '=HYPERLINK("bad")';
  const r = buildReport(d, "personal", "ytd", end, now);
  assert.ok(reportCsv(r).includes('"\'=HYPERLINK(""bad"")"'));
  assert.equal(r.transactions.find((t) => !t.transfer)?.merchant, '=HYPERLINK("bad")');
  assert.ok(reportCsv(r).includes('"bank"'));
});

test("trailing periods are inclusive and handle leap day", () => {
  assert.equal(buildReport(EMPTY_DATA, "personal", "30d", end, now).period.start, "2026-09-25");
  assert.equal(buildReport(EMPTY_DATA, "personal", "12m", "2024-02-29", now).period.start, "2023-03-01");
});
