import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeAccounts } from "./accounts-fix";
import { confirmFinding, rollBillsForward } from "./bill-intel";
import { applySync, categoryFor, type SyncResult, type SyncTxn } from "./plaid-apply";
import { spendKind } from "./spend";
import { EMPTY_DATA, type Account, type BankLink, type Bill, type MoneyData, type RecurringFinding } from "./types";

/*
 * The data problems Maverick's coordinator reported on 2026-11-12, with made-up
 * amounts: bank transactions doubled on one checking account, a transfer from
 * Gladiator Payroll counted as Personal income, the same bill listed twice, and
 * bills stuck on dates that had gone by.
 */

const link = (id: string, connectedAt: string): BankLink => ({ id, itemId: `item-${id}`, institution: "M&T Bank", link: "sealed", cursor: "", connectedAt, scope: "personal" });
// Personal checking, fed by L0 and reached a second time through L1 (another login to the same bank).
const checking: Account = { id: "chk", name: "Checking", nickname: "Personal Checking", type: "checking", openingBalance: 0, scope: "personal", last4: "0001", plaid: { linkId: "L0", accountId: "L0-chk" }, plaidAliases: [{ linkId: "L1", accountId: "L1-chk" }] };
const base = (): MoneyData => ({ ...EMPTY_DATA, accounts: [checking], bankLinks: [link("L0", "2026-10-20T00:00:00Z"), link("L1", "2026-10-25T00:00:00Z")] });
const page = (linkId: string, added: SyncTxn[]): SyncResult => ({
  cursor: `${linkId}-next`,
  institution: "M&T Bank",
  accounts: [{ id: `${linkId}-chk`, name: "Checking", mask: "0001", type: "depository", subtype: "checking", current: null }],
  added,
  modified: [],
  removed: [],
});
const ptx = (id: string, accountId: string, date: string, amount: number, name: string, category = "GENERAL_MERCHANDISE|GENERAL_MERCHANDISE_OTHER"): SyncTxn => ({ id, accountId, amount, date, name, pending: false, category });
const sync = (d: MoneyData, linkId: string, added: SyncTxn[]) => applySync(d, d.bankLinks.find((l) => l.id === linkId)!, page(linkId, added));

test("the second connection's copy arriving first is taken over by the main connection, not doubled", () => {
  // 11/10: the second login's batch landed before the main one's, so every transaction that day came in twice.
  let d = sync(base(), "L1", [ptx("b1", "L1-chk", "2026-11-10", 12.5, "7-Eleven"), ptx("b2", "L1-chk", "2026-11-10", 40, "PIN GREEN VALLEY MARKE")]);
  assert.equal(d.transactions.length, 2);
  const first = d.transactions.find((t) => t.amount === 40)!;
  d = { ...d, transactions: d.transactions.map((t) => (t.id === first.id ? { ...t, category: "Groceries", categoryLocked: true } : t)) };
  d = sync(d, "L0", [ptx("a1", "L0-chk", "2026-11-10", 12.5, "7-Eleven"), ptx("a2", "L0-chk", "2026-11-10", 40, "Green Valley Market")]);
  assert.equal(d.transactions.length, 2);
  const grocery = d.transactions.find((t) => t.amount === 40)!;
  assert.equal(grocery.id, first.id, "the record you already had is kept");
  assert.equal(grocery.plaidId, "a2");
  assert.equal(grocery.plaidLink, "L0");
  assert.equal(grocery.category, "Groceries", "your category stays");
  // And the second connection sending it again later changes nothing.
  d = sync(d, "L1", [ptx("b3", "L1-chk", "2026-11-10", 12.5, "7-Eleven")]);
  assert.equal(d.transactions.length, 2);
});

test("the main connection first, then the second connection: still one record each", () => {
  let d = sync(base(), "L0", [ptx("a1", "L0-chk", "2026-11-12", 3000, "Payee")]);
  d = sync(d, "L1", [ptx("b1", "L1-chk", "2026-11-12", 3000, "Payee")]);
  assert.equal(d.transactions.length, 1);
  assert.equal(d.transactions[0].plaidId, "a1");
});

test("real same-day charges of one amount are each kept once, through either connection", () => {
  const three = (pre: string, acct: string) => [1, 2, 3].map((i) => ptx(`${pre}${i}`, acct, "2026-09-28", 20, "OpenAI"));
  let d = sync(base(), "L0", three("a", "L0-chk"));
  assert.equal(d.transactions.length, 3);
  d = sync(d, "L1", three("b", "L1-chk"));
  assert.equal(d.transactions.length, 3);
  // A fourth real charge posting later through the main connection is new, not a copy.
  d = sync(d, "L0", [ptx("a4", "L0-chk", "2026-09-28", 20, "OpenAI")]);
  assert.equal(d.transactions.length, 4);
});

test("an account with one connection never folds two real charges together", () => {
  const solo: MoneyData = { ...base(), accounts: [{ ...checking, plaidAliases: undefined }], bankLinks: [link("L0", "2026-10-20T00:00:00Z")] };
  let d = sync(solo, "L0", [ptx("a1", "L0-chk", "2026-11-06", 9.99, "7-Eleven")]);
  d = sync(d, "L0", [ptx("a2", "L0-chk", "2026-11-06", 9.99, "7-Eleven")]);
  assert.equal(d.transactions.length, 2);
});

test("a transfer between your own accounts is filed as Transfer, not income or spending", () => {
  assert.equal(categoryFor("TRANSFER_IN|TRANSFER_IN_ACCOUNT_TRANSFER", true), "Transfer");
  assert.equal(categoryFor("TRANSFER_OUT|TRANSFER_OUT_ACCOUNT_TRANSFER", false), "Transfer");
  assert.equal(categoryFor("", true, "WEB XFER FROM CHK 0000000000"), "Transfer");
  assert.equal(categoryFor("INCOME|INCOME_WAGES", true), "Salary");
  assert.equal(categoryFor("", true, "DIRECT DEPOSIT ACME"), "Other income");
  const d = sync(base(), "L0", [ptx("a1", "L0-chk", "2026-11-12", 3000, "WEB XFER FROM CHK 0000000000", "TRANSFER_IN|TRANSFER_IN_ACCOUNT_TRANSFER")].map((t) => ({ ...t, amount: -t.amount })));
  const t = d.transactions[0];
  assert.equal(t.kind, "income");
  assert.equal(t.category, "Transfer");
  assert.equal(spendKind(t, false), "transfer");
});

test("merging two copies of one account keeps one of each transaction even when the banks word it differently", () => {
  const copy: Account = { ...checking, id: "chk2", plaid: { linkId: "L1", accountId: "L1-chk" }, plaidAliases: undefined };
  const d: MoneyData = {
    ...base(),
    accounts: [{ ...checking, plaidAliases: undefined }, copy],
    transactions: [
      { id: "k1", accountId: "chk", date: "2026-09-21", amount: 30, kind: "expense", category: "Other", description: "Anthropic", plaidId: "a1" },
      { id: "k2", accountId: "chk", date: "2026-09-21", amount: 30, kind: "expense", category: "Other", description: "Anthropic", plaidId: "a2" },
      { id: "c1", accountId: "chk2", date: "2026-09-21", amount: 30, kind: "expense", category: "Other", description: "ANTHROPIC ANTHROPIC.COM", plaidId: "b1" },
      { id: "c2", accountId: "chk2", date: "2026-09-21", amount: 30, kind: "expense", category: "Other", description: "ANTHROPIC ANTHROPIC.COM", plaidId: "b2" },
      { id: "c3", accountId: "chk2", date: "2026-09-21", amount: 30, kind: "expense", category: "Other", description: "ANTHROPIC ANTHROPIC.COM", plaidId: "b3" },
      { id: "c4", accountId: "chk2", date: "2026-09-22", amount: 5, kind: "expense", category: "Other", description: "Only here", plaidId: "b4" },
    ],
  };
  const out = dedupeAccounts(d).data;
  assert.deepEqual(out.accounts.map((a) => a.id), ["chk"]);
  // Two already there, the third copy is a real third charge the kept account was missing, plus the one only the copy had.
  assert.equal(out.transactions.length, 4);
  assert.ok(out.transactions.every((t) => t.accountId === "chk"));
});

const bill = (id: string, name: string, amount: number, nextDue: string, extra: Partial<Bill> = {}): Bill => ({ id, name, amount, category: "Software & subscriptions", frequency: "monthly", nextDue, dueDay: Number(nextDue.slice(8)), accountId: "chk", autopay: true, scope: "business", ...extra });
const finding = (id: string, merchant: string, amount: number): RecurringFinding => ({
  id, key: `out|${merchant.toUpperCase()}|pm`, direction: "out", merchant, scope: "business", cadence: "monthly", typical: amount, min: amount, max: amount,
  firstDate: "2026-08-27", lastDate: "2026-10-27", usualDay: 27, nextExpected: "2026-11-27", confidence: "high", reasons: [], occurrences: [], accountIds: ["chk"],
  category: "Software & subscriptions", status: "detected", updatedAt: "2026-11-01T00:00:00Z",
});

test("confirming a bank finding for a bill you already have ties them together instead of adding a second bill", () => {
  const d: MoneyData = { ...base(), bills: [bill("wb-openai", "Openai Chatgpt", 20, "2026-09-28", { url: "https://chatgpt.com" })], recurring: [finding("f1", "ChatGPT", 20)] };
  const out = confirmFinding(d, "f1", () => "new");
  assert.equal(out.bills.length, 1);
  assert.equal(out.bills[0].id, "wb-openai");
  assert.equal(out.bills[0].recurringId, "f1");
  assert.equal(out.bills[0].url, "https://chatgpt.com");
  assert.ok(out.bills[0].nextDue > "2026-09-28", "a stale date takes the finding's next date");
  assert.equal(out.recurring[0].billId, "wb-openai");
});

test("separate subscriptions with one first word stay separate bills", () => {
  const prime = finding("f-a", "Prime Video channel A", 9);
  const d: MoneyData = { ...base(), bills: [bill("b-a", "Prime Video channel A", 9, "2026-12-07", { recurringId: "f-a" })], recurring: [prime, finding("f-b", "Prime Video channel B", 9)] };
  const out = confirmFinding(d, "f-b", () => "b-b");
  assert.equal(out.bills.length, 2);
});

test("bills whose date has gone by move on: autopay always, others only when the bank shows the payment", () => {
  const d: MoneyData = {
    ...base(),
    bills: [
      bill("auto", "Hulu", 18, "2026-10-28"),
      bill("rent", "Rent", 1500, "2026-11-01", { autopay: false, scope: "personal", category: "Housing" }),
      bill("cs", "Child support", 400, "2026-10-15", { autopay: false, scope: "personal", category: "Other" }),
      bill("future", "Netflix", 15, "2026-11-28"),
      bill("one", "Deposit", 50, "2026-10-01", { frequency: "once" }),
    ],
    transactions: [{ id: "t1", accountId: "chk", date: "2026-11-01", amount: 1500, kind: "expense", category: "Housing", description: "RENT PAYMENT", plaidId: "r1" }],
  };
  const { data, moved } = rollBillsForward(d, "2026-11-12");
  const due = Object.fromEntries(data.bills.map((b) => [b.id, b.nextDue]));
  assert.equal(moved, 2);
  assert.equal(due.auto, "2026-11-28");
  assert.equal(due.rent, "2026-12-01");
  assert.equal(due.cs, "2026-10-15", "no payment seen: still past due");
  assert.equal(due.future, "2026-11-28");
  assert.equal(due.one, "2026-10-01");
  assert.equal(rollBillsForward(data, "2026-11-12").moved, 0, "safe to run again");
});
