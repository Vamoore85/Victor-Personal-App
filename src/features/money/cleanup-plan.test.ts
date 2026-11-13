import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCleanup, planCleanup } from "./cleanup-plan";
import { EMPTY_DATA, type Account, type Bill, type MoneyData, type Transaction } from "./types";

/* The 2026-11-12 state, with made-up amounts: what the one-off clean-up would change, and that planning changes nothing. */

const checking: Account = { id: "chk", name: "Checking", nickname: "Personal Checking", type: "checking", openingBalance: 0, scope: "personal", last4: "0001", plaid: { linkId: "L0", accountId: "x" }, plaidAliases: [{ linkId: "L1", accountId: "y" }] };
const card: Account = { id: "card", name: "Card", type: "credit", openingBalance: 0, scope: "personal", last4: "0002", plaid: { linkId: "L2", accountId: "z" } };
const payroll: Account = { id: "pay", name: "Payroll", nickname: "Gladiator Payroll", type: "checking", openingBalance: 0, scope: "gladiator", last4: "0003", plaid: { linkId: "L0", accountId: "w" } };
let n = 0;
const t = (accountId: string, date: string, amount: number, description: string, extra: Partial<Transaction> = {}): Transaction => ({ id: `t${++n}`, accountId, date, amount, kind: "expense", category: "Other", description, plaidId: `p${n}`, ...extra });
const bill = (id: string, name: string, nextDue: string, extra: Partial<Bill> = {}): Bill => ({ id, name, amount: 20, category: "Other", frequency: "monthly", nextDue, dueDay: Number(nextDue.slice(8)), accountId: "chk", autopay: true, scope: "personal", ...extra });

function state(): MoneyData {
  n = 0;
  const transactions = [
    t("chk", "2026-11-10", 12.5, "7-Eleven"), t("chk", "2026-11-10", 12.5, "7-Eleven", { categoryLocked: true, category: "Shopping" }), // doubled
    t("chk", "2026-11-10", 40, "Green Valley Market"), t("chk", "2026-11-10", 40, "PIN GREEN VALLEY MARKE"), // doubled, worded two ways
    t("card", "2026-10-26", 6, "Starbucks"), t("card", "2026-10-26", 6, "Starbucks"), // one connection: could be two coffees
    t("chk", "2026-11-12", 3000, "WEB XFER FROM CHK 0000000000", { kind: "income", category: "Other income" }),
    t("pay", "2026-11-12", 3000, "WEB XFER TO CHK 0000000000", { category: "Owner draw" }),
  ];
  return {
    ...EMPTY_DATA,
    accounts: [checking, card, payroll],
    transactions,
    bankLinks: [{ id: "L0", itemId: "i0", institution: "M&T Bank", link: "s", cursor: "c" }, { id: "L1", itemId: "i1", institution: "M&T Bank", link: "s", cursor: "c" }, { id: "L2", itemId: "i2", institution: "Capital One", link: "s", cursor: "c" }],
    bills: [bill("wb", "Ignition interlock", "2026-10-25"), bill("bf", "Ignition Interlock", "2026-11-19", { recurringId: "f1" }), bill("rent", "Rent", "2026-11-01", { autopay: false, amount: 1500 })],
    accountRules: 4,
  };
}

test("the plan lists each problem and changes nothing", () => {
  const d = state();
  const before = JSON.stringify(d);
  const plan = planCleanup(d, "2026-11-12");
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual(plan.counts, {
    duplicateGroups: 3, transactionsToRemove: 2, certain: 1, reworded: 1, needsReview: 1,
    transfersToRefile: 1, duplicateBills: 1, billsRolledForward: 0, billsStillOverdue: 1, budgets: 0,
  });
  const certain = plan.duplicates.find((g) => g.confidence === "certain")!;
  assert.deepEqual(certain.keep, ["t2"], "the one you categorized by hand is kept");
  assert.deepEqual(plan.bills, [{ keep: "bf", remove: "wb", names: ["Ignition Interlock", "Ignition interlock"], scope: "personal" }]);
  assert.equal(plan.transfers[0].counterpart, true);
  assert.ok(!plan.transfers[0].description.includes("0000000000"), "no account numbers in the plan");
});

test("an approved plan, applied, leaves one of each and the transfer out of income", () => {
  const d = state();
  const out = applyCleanup(d, planCleanup(d, "2026-11-12"), "2026-11-12");
  assert.equal(out.transactions.length, d.transactions.length - 2);
  assert.equal(out.transactions.find((x) => x.description.startsWith("WEB XFER FROM"))!.category, "Transfer");
  assert.deepEqual(out.bills.map((b) => b.id).sort(), ["bf", "rent"]);
  assert.equal(planCleanup(out, "2026-11-12").counts.transactionsToRemove, 0, "nothing left to do");
});
