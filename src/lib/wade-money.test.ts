import { strict as assert } from "node:assert";
import { test } from "node:test";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";
import { wadeMoneySummary } from "./wade-money";

const data = {
  ...EMPTY_DATA,
  accounts: [
    { id: "a1", name: "M&T Checking", nickname: "Maverick checking", type: "checking", openingBalance: 100, scope: "business", last4: "5443",
      plaid: { linkId: "L", accountId: "P" }, bankBalance: { current: 900.5, available: 850, asOf: "2026-10-31T12:00:00Z" } },
    { id: "a2", name: "Mystery", type: "checking", openingBalance: 0, needsEntity: true },
  ],
  transactions: [
    { id: "t1", date: "2026-10-30", description: "Client payment", amount: 1000, kind: "income", category: "Income", accountId: "a1", plaidId: "x" },
    { id: "t2", date: "2026-10-29", description: "Software", amount: 50, kind: "expense", category: "Software", accountId: "a1" },
    { id: "t3", date: "2025-01-01", description: "Old", amount: 5, kind: "expense", category: "Software", accountId: "a1" },
  ],
  bills: [{ id: "b1", name: "Verizon", amount: 120, category: "Phone", frequency: "monthly", nextDue: "2026-11-05", dueDay: 5, accountId: "a1",
    autopay: true, url: "https://verizon.example/pay", scope: "business", emailSource: { key: "k", ids: ["secret-mail-id"], evidence: "mail text" } }],
  budgets: [{ id: "g1", category: "Software", monthlyLimit: 200, scope: "business" }],
  institutions: [{ id: "i1", name: "Bank", loginUrl: "https://bank.example/login", notes: "private note" }],
} as unknown as MoneyData;

test("Wade's view has money facts by company and nothing else", () => {
  const s = wadeMoneySummary(data, new Date("2026-10-31T15:00:00Z"));
  assert.deepEqual(s.accounts[0], { name: "Maverick checking", entity: "Maverick", type: "checking", last4: "5443", liability: false,
    bank_current: 900.5, bank_available: 850, bank_as_of: "2026-10-31T12:00:00Z", ledger_balance: 1045, credit_limit: null });
  assert.equal(s.accounts[1].entity, "Unassigned");
  assert.deepEqual(s.transactions.map((t) => [t.date, t.amount]), [["2026-10-30", 1000], ["2026-10-29", -50]]);
  assert.equal(s.bills[0].pays_from, "Maverick checking");
  assert.deepEqual(s.budgets[0], { category: "Software", entity: "Maverick", monthly_limit: 200, spent_this_month: 50 });
  const text = JSON.stringify(s);
  for (const hidden of ["verizon.example", "secret-mail-id", "mail text", "bank.example", "private note", "\"P\"", "plaid"]) assert.ok(!text.includes(hidden), hidden);
});
