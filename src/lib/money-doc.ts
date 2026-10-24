import { readDoc, writeDoc } from "@/lib/db";
import { EMPTY_DATA, type MoneyData } from "@/features/money/types";

// The Financial Center's data as the server sees it: the same "money" row the
// browser loads and saves through /api/money.

export const MONEY_DOC = "money";

/** The fields the server works with, filled in when an older copy lacks them. */
export function asMoney(data: unknown): MoneyData {
  const v = (data ?? {}) as Partial<MoneyData>;
  const out = { ...EMPTY_DATA, ...v } as MoneyData;
  for (const k of ["accounts", "transactions", "bankLinks", "rules", "briefings"] as const) if (!Array.isArray(out[k])) (out as Record<string, unknown>)[k] = [];
  return out;
}

/** Applies a change to the saved money data, retrying when another save lands first. */
export async function updateMoney(change: (d: MoneyData) => MoneyData): Promise<{ rev: number; data: MoneyData }> {
  for (let i = 0; i < 5; i++) {
    const doc = await readDoc(MONEY_DOC);
    const next = change(asMoney(doc?.data));
    const saved = await writeDoc(MONEY_DOC, doc?.rev ?? 0, next);
    if (saved.ok) return { rev: saved.rev, data: next };
  }
  throw new Error("The money data kept changing while saving.");
}

/** One line per account for the hosting's logs: last 4, entity, type, bank feed and balance age. Never amounts or names. */
export function accountDiag(data: unknown) {
  const d = asMoney(data);
  const links = new Map(d.bankLinks.map((l) => [l.id, l]));
  return d.accounts
    .map((a) => {
      const link = a.plaid ? links.get(a.plaid.linkId) : undefined;
      const bb = a.bankBalance;
      const bal = !bb ? "none" : bb.current === null && bb.available === null ? "empty" : `${Math.round((Date.now() - new Date(bb.asOf).getTime()) / 36e5)}h`;
      const bank = d.transactions.filter((t) => t.accountId === a.id && t.plaidId).length;
      const other = d.transactions.filter((t) => t.accountId === a.id && !t.plaidId).length;
      return `${a.last4 ?? "----"}/${a.scope ?? "personal"}/${a.type}/feed=${!a.plaid ? "none" : link ? "live" : "removed"}/bal=${bal}/tx=${bank}+${other}`;
    })
    .join(" ");
}
