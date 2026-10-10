import { randomUUID } from "node:crypto";
import { EMPTY_DATA, type Account, type MoneyData, type Transaction } from "@/features/money/types";

/*
 * Statements Claude converted for you, delivered through the PENDING_IMPORT
 * environment variable in Vercel instead of the (public) code repository.
 * Format: {"account": {"name", "type", "openingBalance"}, "rows": [[date, description, signedAmount, category], ...]}.
 * Merged into the saved data the next time the app loads; rows already
 * there are skipped, so it is safe to leave set until it's removed.
 */

type Pending = { account: { name: string; type: Account["type"]; openingBalance: number }; rows: [string, string, number, string][] };

function pending(): Pending | null {
  const raw = process.env.PENDING_IMPORT;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Pending;
  } catch {
    console.error("PENDING_IMPORT isn't valid JSON");
    return null;
  }
}

const key = (t: Pick<Transaction, "date" | "amount" | "kind" | "description">) =>
  `${t.date}|${t.amount.toFixed(2)}|${t.kind}|${t.description.toLowerCase()}`;

/** Returns the merged data, or null when there's nothing new to add. */
export function applyPendingImport(current: unknown): MoneyData | null {
  const p = pending();
  if (!p) return null;
  const base = { ...EMPTY_DATA, ...((current as Partial<MoneyData>) ?? {}) } as MoneyData;
  let accounts = base.accounts ?? [];
  let account = accounts.find((a) => a.name === p.account.name && a.scope === "business");
  if (!account) {
    account = { id: randomUUID(), name: p.account.name, type: p.account.type, openingBalance: p.account.openingBalance, scope: "business" };
    accounts = [...accounts, account];
  }
  const seen = new Set((base.transactions ?? []).filter((t) => t.accountId === account!.id).map(key));
  const added: Transaction[] = [];
  for (const [date, description, signed, category] of p.rows) {
    const t: Transaction = {
      id: randomUUID(),
      date,
      description,
      amount: Math.abs(signed),
      kind: signed > 0 ? "income" : "expense",
      category,
      accountId: account.id,
    };
    if (seen.has(key(t))) continue;
    seen.add(key(t));
    added.push(t);
  }
  if (added.length === 0 && accounts === base.accounts) return null;
  return { ...base, accounts, transactions: [...(base.transactions ?? []), ...added] };
}
