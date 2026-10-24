import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanAccounts } from "./accounts-fix";
import { balances } from "./outlook";
import { applySync } from "./plaid-apply";
import { EMPTY_DATA, type Account, type BankLink, type MoneyData, type Transaction } from "./types";

/*
 * The production case of 2026-10-24, with made-up amounts: one bank login
 * connected three times. The first connection feeds ··5105, ··5815 (Gladiator)
 * and ··5249; reconnecting "for Maverick" twice made two more connections whose
 * copies of the same three accounts landed under Maverick, so Maverick's cash
 * counted each account twice. ··5443 (checking, filled from statements, no live
 * connection) is Gladiator's by the owner's word. Two cards have no connection.
 */

const now = new Date().toISOString();
const link = (id: string, at: string, scope: BankLink["scope"]): BankLink => ({ id, itemId: `item-${id}`, institution: "M&T Bank", link: "sealed", cursor: "c", connectedAt: at, lastSync: now, historyStatus: "HISTORICAL_UPDATE_COMPLETE", scope });
const acct = (id: string, last4: string, scope: Account["scope"], linkId: string | null, bal: number | null, type: Account["type"] = "checking"): Account => ({
  id,
  name: `Account ${last4}`,
  type,
  openingBalance: 0,
  scope,
  last4,
  ...(linkId ? { plaid: { linkId, accountId: `${linkId}-${last4}` } } : {}),
  ...(bal !== null ? { bankBalance: { current: bal, available: bal, asOf: now } } : {}),
});
const txn = (id: string, accountId: string, date: string, amount: number, plaid = true): Transaction => ({ id, accountId, date, amount, kind: "expense", category: "Other", description: `Payee ${amount}`, ...(plaid ? { plaidId: `p-${id}` } : {}) });

function production(): MoneyData {
  const accounts = [
    acct("a5443", "5443", "business", null, null),
    acct("a5668", "5668", "personal", null, null, "credit"),
    acct("a6846", "6846", "personal", null, null, "credit"),
    acct("g5105", "5105", "gladiator", "L0", 1000),
    acct("g5815", "5815", "gladiator", "L0", 200),
    acct("p5249", "5249", "personal", "L0", 300),
    acct("m5105a", "5105", "business", "L1", 1000),
    acct("m5249a", "5249", "business", "L1", 300),
    acct("m5815a", "5815", "business", "L1", 200),
    acct("m5105b", "5105", "business", "L2", 1000),
    acct("m5249b", "5249", "business", "L2", 300),
    acct("m5815b", "5815", "business", "L2", 200),
  ];
  const transactions: Transaction[] = [];
  for (const base of ["5105", "5815", "5249"]) {
    const orig = accounts.find((a) => a.last4 === base && a.plaid?.linkId === "L0")!.id;
    for (let i = 1; i <= 3; i++) transactions.push(txn(`${orig}-${i}`, orig, `2026-10-0${i}`, 10 * i));
    for (const copy of accounts.filter((a) => a.last4 === base && a.plaid && a.plaid.linkId !== "L0")) {
      for (let i = 1; i <= 3; i++) transactions.push(txn(`${copy.id}-${i}`, copy.id, `2026-10-0${i}`, 10 * i)); // the same bank transactions again
    }
  }
  transactions.push(txn("st1", "a5443", "2026-09-01", 55, false), txn("bk1", "a5443", "2026-09-02", 66));
  return {
    ...EMPTY_DATA,
    accounts,
    transactions,
    bankLinks: [link("L0", "2026-10-20T10:00:00Z", "personal"), link("L1", "2026-10-24T20:31:00Z", "business"), link("L2", "2026-10-24T20:33:00Z", "business")],
  };
}

const cashTotal = (d: MoneyData) => balances(d).reduce((s, b) => s + b.available, 0);

test("before the fix the duplicate copies double-count Maverick's cash", () => {
  const d = { ...production(), accountRules: 1 }; // rules off: the raw state
  const maverick = balances(d).find((b) => b.entity === "business")!;
  assert.equal(maverick.accounts.filter((a) => a.amount !== null).length, 6);
  assert.equal(maverick.available, 3000); // 1500 of real cash, counted twice
});

test("each real bank account is kept once and cash counts it once", () => {
  const { data, before, after, merged } = cleanAccounts(production());
  assert.equal(before, 12);
  assert.equal(after, 6);
  assert.equal(merged, 6);
  const ids = data.accounts.map((a) => a.id).sort();
  assert.deepEqual(ids, ["a5443", "a5668", "a6846", "g5105", "g5815", "p5249"]);
  // Each bank account appears once across every company's cash.
  const cashLines = balances(data).flatMap((b) => b.accounts.filter((a) => a.amount !== null).map((a) => a.last4));
  assert.equal(new Set(cashLines).size, cashLines.length);
  assert.ok(cashTotal(data) <= 1500);
  // The repeated transactions are kept once; history stays on the oldest record.
  for (const id of ["g5105", "g5815", "p5249"]) assert.equal(data.transactions.filter((t) => t.accountId === id).length, 3);
  // The two later connections only reach copies, so they stop syncing.
  assert.equal(data.bankLinks.find((l) => l.id === "L1")!.duplicateOf, "L0");
  assert.equal(data.bankLinks.find((l) => l.id === "L2")!.duplicateOf, "L0");
  assert.equal(data.bankLinks.find((l) => l.id === "L0")!.duplicateOf, undefined);
});

test("no account is put under Maverick by default; only clear choices and the owner's correction stand", () => {
  const { data } = cleanAccounts(production());
  const by = (id: string) => data.accounts.find((a) => a.id === id)!;
  // ··5443 is Gladiator by the owner's word: assigned by its record id, history moves with it.
  assert.equal(by("a5443").scope, "gladiator");
  assert.equal(by("a5443").needsEntity, undefined);
  // Moved away from what their connection defaulted to: a clear choice, kept.
  assert.equal(by("g5105").scope, "gladiator");
  assert.equal(by("g5815").scope, "gladiator");
  // Same as the connection's default, or no connection: not a choice, so needs assignment.
  assert.equal(by("p5249").needsEntity, true);
  assert.equal(by("a5668").needsEntity, true);
  assert.equal(by("a6846").needsEntity, true);
  const maverick = balances(data).find((b) => b.entity === "business")!;
  assert.equal(maverick.accounts.length + maverick.cards.length, 0);
  assert.equal(maverick.available, 0);
  assert.equal(maverick.counted, 0);
});

test("··5443 shows under Gladiator as missing a live balance, never as cash", () => {
  const { data } = cleanAccounts(production());
  const gladiator = balances(data).find((b) => b.entity === "gladiator")!;
  const row = gladiator.accounts.find((a) => a.last4 === "5443")!;
  assert.equal(row.amount, null);
  assert.equal(row.state, "lost");
  assert.equal(gladiator.available, 1200); // ··5105 + ··5815 only
});

test("the clean-up is safe to run again", () => {
  const once = cleanAccounts(production()).data;
  const twice = cleanAccounts(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.after, 6);
});

test("a sync through a duplicate connection doesn't recreate copies", () => {
  const d = cleanAccounts(production()).data;
  const l1 = d.bankLinks.find((l) => l.id === "L1")!;
  const next = applySync(d, l1, {
    cursor: "c2",
    hasMore: false,
    updateStatus: "HISTORICAL_UPDATE_COMPLETE",
    institution: "M&T Bank",
    accounts: ["5105", "5249", "5815"].map((m) => ({ id: `L1-${m}`, name: `Account ${m}`, mask: m, type: "depository", subtype: "checking", current: 1, available: 1 })),
    added: [{ id: "x1", accountId: "L1-5105", amount: 10, date: "2026-10-01", name: "Payee 10", pending: false, category: "" }],
    modified: [],
    removed: [],
  });
  const clean = cleanAccounts(next).data;
  assert.equal(clean.accounts.length, 6);
  assert.equal(clean.transactions.filter((t) => t.accountId === "g5105").length, 3);
});

test("··5105 is Gladiator Payroll and ··5815 is Gladiator Bills, kept apart, and both survive a sync", () => {
  const { data } = cleanAccounts(production());
  const pay = data.accounts.find((a) => a.id === "g5105")!;
  const bills = data.accounts.find((a) => a.id === "g5815")!;
  assert.equal(pay.scope, "gladiator");
  assert.equal(pay.nickname, "Gladiator Payroll");
  assert.equal(pay.name, "Account 5105"); // the bank's name stays as the secondary label
  assert.equal(bills.scope, "gladiator");
  assert.equal(bills.nickname, "Gladiator Bills");
  assert.notEqual(pay.id, bills.id);
  const gl = balances(data).find((b) => b.entity === "gladiator")!;
  assert.deepEqual(gl.accounts.map((a) => a.name).sort(), ["Account 5443", "Gladiator Bills", "Gladiator Payroll"]);
  assert.equal(gl.accounts.find((a) => a.name === "Gladiator Payroll")!.bankName, "Account 5105");
  // A sync from their own connection keeps the company and the name.
  const l0 = data.bankLinks.find((l) => l.id === "L0")!;
  const synced = cleanAccounts(
    applySync(data, l0, {
      cursor: "c3",
      hasMore: false,
      updateStatus: "HISTORICAL_UPDATE_COMPLETE",
      institution: "M&T Bank",
      accounts: ["5105", "5815", "5249"].map((m) => ({ id: `L0-${m}`, name: `Bank name ${m}`, mask: m, type: "depository", subtype: "checking", current: 5, available: 5 })),
      added: [{ id: "y1", accountId: "L0-5105", amount: 12, date: "2026-10-22", name: "Payee 12", pending: false, category: "" }],
      modified: [],
      removed: [],
    }),
  ).data;
  const after = synced.accounts.find((a) => a.id === "g5105")!;
  assert.equal(after.scope, "gladiator");
  assert.equal(after.nickname, "Gladiator Payroll");
  assert.equal(synced.accounts.find((a) => a.id === "g5815")!.nickname, "Gladiator Bills");
  assert.equal(synced.transactions.filter((t) => t.accountId === "g5105").length, 4);
  // Not in Maverick's or Personal's figures.
  for (const e of ["business", "personal"] as const) {
    const b = balances(synced).find((x) => x.entity === e)!;
    assert.ok(!b.accounts.some((a) => a.last4 === "5105" || a.last4 === "5815"));
  }
});

test("a database already on rules version 1 gets the version 2 names without redoing version 1", () => {
  const v1 = { ...cleanAccounts(production()).data, accountRules: 1 };
  const p = v1.accounts.find((a) => a.id === "g5105")!;
  delete p.nickname;
  const { data } = cleanAccounts(v1);
  assert.equal(data.accounts.find((a) => a.id === "g5105")!.nickname, "Gladiator Payroll");
  assert.equal(data.accounts.find((a) => a.id === "p5249")!.needsEntity, true);
  assert.equal(data.accountRules, 2);
});
