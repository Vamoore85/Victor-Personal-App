import { accountLabel } from "./accounts-fix";
import { matchingBill, merchantKey, rollBillsForward } from "./bill-intel";
import { OWN_ACCOUNT_TRANSFER } from "./plaid-apply";
import type { Bill, MoneyData, Transaction } from "./types";

/*
 * A one-off clean-up of records saved before the 2026-11-12 fixes, as a plan
 * only: it lists what it would change and changes nothing. Victor approves the
 * plan; applying it is a separate, deliberate step (applyCleanup below, which
 * nothing in the app calls).
 *
 *  - Bank transactions saved twice (two connections to one bank account).
 *  - Transfers between your own accounts filed as Personal income or spending.
 *  - The same bill listed twice in one company.
 *  - Bills stuck on a date that has gone by (what the new roll-forward would move).
 */

export type TxnDuplicate = {
  confidence: "certain" | "reworded" | "review";
  account: string;
  date: string;
  descriptions: string[];
  keep: string[]; // transaction ids
  remove: string[]; // transaction ids (empty for "review")
};

export type CleanupPlan = {
  duplicates: TxnDuplicate[];
  transfers: { id: string; account: string; date: string; description: string; from: string; to: "Transfer"; counterpart: boolean }[];
  bills: { keep: string; remove: string; names: [string, string]; scope: string }[];
  rolled: { id: string; name: string; from: string; to: string }[];
  stillOverdue: { id: string; name: string; nextDue: string; autopay: boolean }[];
  budgets: number;
  counts: Record<string, number>;
};

const firstWord = (description: string) => (merchantKey(description) || description.toUpperCase()).split(" ")[0];

/** Which record of a duplicate to keep: one you touched (category, transfer link, receipt, bill finding), else the main connection's, else the older. */
function rank(d: MoneyData, t: Transaction, index: number, referenced: Set<string>) {
  const acct = d.accounts.find((a) => a.id === t.accountId);
  return (t.categoryLocked ? 1000 : 0) + (t.transferId ? 500 : 0) + (referenced.has(t.id) ? 250 : 0) + (t.plaidLink && t.plaidLink === acct?.plaid?.linkId ? 100 : 0) - index / 1e6;
}

export function planCleanup(d: MoneyData, today: string): CleanupPlan {
  const index = new Map(d.transactions.map((t, i) => [t.id, i]));
  const referenced = new Set([...d.receipts.map((r) => r.transactionId).filter((x): x is string => !!x), ...d.recurring.flatMap((f) => f.occurrences.map((o) => o.txnId))]);
  const multiRoute = new Set(d.accounts.filter((a) => a.plaidAliases?.length).map((a) => a.id));
  const label = (id: string) => {
    const a = d.accounts.find((x) => x.id === id);
    return a ? accountLabel(a) : "(no account)";
  };

  // Bank records with the same account, day, amount, direction and payee.
  const groups = new Map<string, Transaction[]>();
  for (const t of d.transactions) {
    if (!t.plaidId) continue;
    const k = `${t.accountId}|${t.date}|${t.amount.toFixed(2)}|${t.kind}|${firstWord(t.description)}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const duplicates: TxnDuplicate[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const byText = new Map<string, Transaction[]>();
    for (const t of list) byText.set(t.description, [...(byText.get(t.description) ?? []), t]);
    const variants = [...byText.values()];
    const best = (ts: Transaction[]) => [...ts].sort((x, y) => rank(d, y, index.get(y.id)!, referenced) - rank(d, x, index.get(x.id)!, referenced));
    const base = { account: label(list[0].accountId), date: list[0].date, descriptions: [...byText.keys()] };
    if (variants.length === 1 && list.length === 2) {
      // Two identical bank records. Certain on an account reached through two connections; otherwise it could be two real purchases.
      const [keep, drop] = best(list);
      duplicates.push({ ...base, confidence: multiRoute.has(list[0].accountId) ? "certain" : "review", keep: [keep.id], remove: multiRoute.has(list[0].accountId) ? [drop.id] : [] });
    } else if (variants.length === 2 && variants[0].length === variants[1].length) {
      // The same charges worded two ways ("Anthropic" and "ANTHROPIC ANTHROPIC.COM"), one per connection: keep one wording.
      const score = (ts: Transaction[]) => Math.max(...ts.map((t) => rank(d, t, index.get(t.id)!, referenced)));
      const [keepSet, dropSet] = score(variants[0]) >= score(variants[1]) ? variants : [variants[1], variants[0]];
      duplicates.push({ ...base, confidence: "reworded", keep: keepSet.map((t) => t.id), remove: dropSet.map((t) => t.id) });
    } else {
      duplicates.push({ ...base, confidence: "review", keep: list.map((t) => t.id), remove: [] });
    }
  }

  // Personal money moved between your own accounts but filed as income or spending.
  const scopeOf = new Map(d.accounts.map((a) => [a.id, a.scope ?? "personal"]));
  const transfers = d.transactions
    .filter((t) => (scopeOf.get(t.accountId) ?? "personal") === "personal" && !t.transferId && !t.categoryLocked && (t.category === "Other income" || t.category === "Other") && OWN_ACCOUNT_TRANSFER.test(t.description))
    .map((t) => ({
      id: t.id,
      account: label(t.accountId),
      date: t.date,
      description: t.description.replace(/\d{4,}/g, "…"),
      from: t.category,
      to: "Transfer" as const,
      counterpart: d.transactions.some((x) => x.accountId !== t.accountId && x.kind !== t.kind && Math.abs(x.amount - t.amount) < 0.005 && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 3 * 864e5),
    }));

  // The same bill twice in one company: keep the one tied to a bank finding (else the later date), drop the other.
  const bills: CleanupPlan["bills"] = [];
  const gone = new Set<string>();
  for (const b of d.bills) {
    if (gone.has(b.id)) continue;
    const others = d.bills.filter((x) => x.id !== b.id && !gone.has(x.id));
    const twin = matchingBill(others, b.scope ?? "personal", b.name, b.amount); // two bills tied to different findings are skipped just below
    if (!twin || (twin.recurringId && b.recurringId && twin.recurringId !== b.recurringId)) continue;
    const prefer = (x: Bill) => (x.recurringId ? 2 : 0) + (x.nextDue >= today ? 1 : 0);
    const [keep, drop] = prefer(twin) > prefer(b) || (prefer(twin) === prefer(b) && twin.nextDue > b.nextDue) ? [twin, b] : [b, twin];
    gone.add(drop.id);
    bills.push({ keep: keep.id, remove: drop.id, names: [keep.name, drop.name], scope: keep.scope ?? "personal" });
  }

  // What the roll-forward would move, on the bills left after the merge.
  const kept = { ...d, bills: d.bills.filter((b) => !gone.has(b.id)) };
  const rolledData = rollBillsForward(kept, today).data;
  const rolled = rolledData.bills.flatMap((b) => {
    const was = kept.bills.find((x) => x.id === b.id)!;
    return was.nextDue !== b.nextDue ? [{ id: b.id, name: b.name, from: was.nextDue, to: b.nextDue }] : [];
  });
  const stillOverdue = rolledData.bills.filter((b) => b.frequency !== "once" && b.nextDue < today).map((b) => ({ id: b.id, name: b.name, nextDue: b.nextDue, autopay: b.autopay }));

  return {
    duplicates,
    transfers,
    bills,
    rolled,
    stillOverdue,
    budgets: d.budgets.length,
    counts: {
      duplicateGroups: duplicates.length,
      transactionsToRemove: duplicates.reduce((s, x) => s + x.remove.length, 0),
      certain: duplicates.filter((x) => x.confidence === "certain").length,
      reworded: duplicates.filter((x) => x.confidence === "reworded").length,
      needsReview: duplicates.filter((x) => x.confidence === "review").length,
      transfersToRefile: transfers.length,
      duplicateBills: bills.length,
      billsRolledForward: rolled.length,
      billsStillOverdue: stillOverdue.length,
      budgets: d.budgets.length,
    },
  };
}

/**
 * Applies an approved plan. Not called anywhere in the app: run only after
 * Victor approves the plan's list. Anything pointing at a removed transaction
 * (receipts, bill findings) is pointed at the kept one.
 */
export function applyCleanup(d: MoneyData, plan: CleanupPlan, today: string): MoneyData {
  const into = new Map<string, string>();
  for (const g of plan.duplicates) g.remove.forEach((id, i) => into.set(id, g.keep[Math.min(i, g.keep.length - 1)]));
  const refile = new Set(plan.transfers.map((t) => t.id));
  const dropBills = new Map(plan.bills.map((b) => [b.remove, b.keep]));
  const merged = d.bills.filter((b) => !dropBills.has(b.id)).map((b) => {
    const drop = plan.bills.find((x) => x.keep === b.id);
    const other = drop && d.bills.find((x) => x.id === drop.remove);
    return other ? { ...b, url: b.url ?? other.url, institutionId: b.institutionId ?? other.institutionId, note: b.note ?? other.note } : b;
  });
  const next: MoneyData = {
    ...d,
    transactions: d.transactions.filter((t) => !into.has(t.id)).map((t) => (refile.has(t.id) ? { ...t, category: "Transfer" } : t)),
    receipts: d.receipts.map((r) => (r.transactionId && into.has(r.transactionId) ? { ...r, transactionId: into.get(r.transactionId) } : r)),
    recurring: d.recurring.map((f) => ({
      ...f,
      billId: f.billId && dropBills.has(f.billId) ? dropBills.get(f.billId) : f.billId,
      occurrences: f.occurrences.filter((o) => !into.has(o.txnId)),
    })),
    bills: merged,
  };
  return rollBillsForward(next, today).data;
}
