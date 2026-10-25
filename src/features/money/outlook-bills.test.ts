import test from "node:test";
import assert from "node:assert/strict";
import { upcoming, recurringRows } from "./outlook";
import { EMPTY_DATA, type Bill, type MoneyData, type RecurringFinding } from "./types";

const now = "2026-10-25";
const bill: Bill = { id: "saved", name: "Example obligation", amount: 80, category: "Bills", frequency: "monthly", nextDue: "2026-11-01", dueDay: 1, accountId: "bank", autopay: false, scope: "personal" };
const finding: RecurringFinding = {
  id: "pattern", key: "out|EXAMPLE|pm", direction: "out", merchant: "Example obligation", scope: "personal",
  cadence: "monthly", typical: 80, min: 80, max: 80, firstDate: "2026-09-03", lastDate: "2026-10-03",
  usualDay: 3, nextExpected: "2026-11-03", confidence: "medium", reasons: [], category: "Bills", status: "review", updatedAt: now,
  accountIds: ["bank"], occurrences: [{ txnId: "paid", date: "2026-10-03", amount: 80, accountId: "bank", source: "bank" }],
};
const data = (): MoneyData => ({ ...EMPTY_DATA, accounts: [{ id: "bank", name: "Checking", type: "checking", openingBalance: 0, scope: "personal" }], bills: [bill], recurring: [finding] });

test("a unique exact bank finding reuses a saved bill's schedule without a second forecast", () => {
  const d = data();
  const before = JSON.stringify(d);
  const lines = upcoming(d, 30, now);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].billId, bill.id);
  assert.equal(lines[0].date, bill.nextDue);
  assert.equal(recurringRows(d)[0].nextDate, bill.nextDue);
  assert.equal(d.recurring[0].status, "review");
  assert.equal(JSON.stringify(d), before);
});

test("ambiguous ownership, account, amount, cadence, or edited findings are not silently combined", () => {
  const examples: MoneyData[] = [
    { ...data(), bills: [{ ...bill, scope: "gladiator" }] },
    { ...data(), bills: [{ ...bill, accountId: "different-bank" }] },
    { ...data(), bills: [{ ...bill, amount: 90 }] },
    { ...data(), bills: [{ ...bill, frequency: "biweekly" }] },
    { ...data(), bills: [bill, { ...bill, id: "second-obligation" }] },
    { ...data(), recurring: [{ ...finding, overrides: { nextDate: "2026-11-09" } }] },
    { ...data(), recurring: [{ ...finding, accountIds: [] }] },
  ];
  for (const d of examples) assert.ok(upcoming(d, 30, now).some(line => line.findingId === finding.id));
});
