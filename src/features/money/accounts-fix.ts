import type { Account, BankLink, MoneyData, Scope, Transaction } from "./types";

/*
 * Keeping each real bank account exactly once, with the company you gave it.
 *
 * Connecting the same bank login twice gives Plaid two connections whose
 * accounts have different Plaid ids, so without this the app kept every
 * account twice and added both copies to cash. Here the copies are folded into
 * the oldest record (its history and company stay), the newest bank balance is
 * kept, and a connection that only reaches accounts already fed by an older one
 * is marked as a duplicate and no longer synced.
 *
 * Which company an account belongs to is never inferred from the bank or the
 * account name: an account is either assigned (by you) or "needs assignment".
 */

export const ACCOUNT_RULES = 1;

const debt = (a: Account) => a.type === "credit" || a.type === "loan";
const txnKey = (t: Transaction) => `${t.date}|${t.amount}|${t.kind}|${t.description}`;

/** Accounts you haven't given a company yet are left out of every company's totals. */
export const isAssigned = (a: Account | undefined) => !!a && !a.needsEntity;

/**
 * The bank account behind a record, the same across connections to one bank:
 * institution + last 4 + kind of account. Records without an institution or
 * last 4 are only ever matched by their Plaid account id.
 */
export function bankKey(d: MoneyData, a: Account): string | null {
  if (!a.plaid) return null;
  const link = d.bankLinks.find((l) => l.id === a.plaid!.linkId);
  if (!link) return null;
  if (!link.institution || !a.last4) return `id|${a.plaid.linkId}|${a.plaid.accountId}`;
  return `${link.institution.toLowerCase()}|${a.last4}|${debt(a) ? "debt" : "cash"}|${a.type}`;
}

/** Folds every copy of the same bank account into one record. Safe to run any number of times. */
export function dedupeAccounts(d: MoneyData): { data: MoneyData; merged: number } {
  const order = new Map(d.bankLinks.map((l, i) => [l.id, [l.connectedAt ?? "", i] as const]));
  const older = (a: Account, b: Account) => {
    const x = order.get(a.plaid!.linkId)!;
    const y = order.get(b.plaid!.linkId)!;
    return x[0] === y[0] ? x[1] - y[1] : x[0] && y[0] ? x[0].localeCompare(y[0]) : x[1] - y[1];
  };
  const groups = new Map<string, Account[]>();
  for (const a of d.accounts) {
    const k = bankKey(d, a);
    if (k) groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  const into = new Map<string, Account>(); // copy id -> kept record
  const kept = new Map<string, Account>(); // kept id -> updated record
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const [keep, ...copies] = [...list].sort(older);
    const balances = list.map((a) => a.bankBalance).filter((b): b is NonNullable<Account["bankBalance"]> => !!b);
    const newest = balances.sort((x, y) => y.asOf.localeCompare(x.asOf))[0];
    const aliases = [...(keep.plaidAliases ?? [])];
    for (const c of copies) {
      for (const p of [c.plaid!, ...(c.plaidAliases ?? [])]) if (!aliases.some((x) => x.linkId === p.linkId && x.accountId === p.accountId)) aliases.push(p);
      into.set(c.id, keep);
    }
    kept.set(keep.id, { ...keep, bankBalance: newest ?? keep.bankBalance, plaidAliases: aliases });
  }
  if (!into.size) return { data: d, merged: 0 };

  // History moves onto the kept record; the same transaction seen through two connections is kept once.
  const seen = new Map<string, Set<string>>();
  for (const t of d.transactions) if (!into.has(t.accountId)) (seen.get(t.accountId) ?? seen.set(t.accountId, new Set()).get(t.accountId)!).add(txnKey(t));
  const transactions: Transaction[] = [];
  for (const t of d.transactions) {
    const to = into.get(t.accountId);
    if (!to) {
      transactions.push(t);
      continue;
    }
    const s = seen.get(to.id) ?? seen.set(to.id, new Set()).get(to.id)!;
    if (s.has(txnKey(t))) continue;
    s.add(txnKey(t));
    transactions.push({ ...t, accountId: to.id });
  }
  const re = (id: string) => into.get(id)?.id ?? id;
  const accounts = d.accounts.filter((a) => !into.has(a.id)).map((a) => kept.get(a.id) ?? a);

  // A connection none of whose accounts is its own any more only makes copies: stop syncing it.
  const bankLinks = d.bankLinks.map((l): BankLink => {
    if (accounts.some((a) => a.plaid?.linkId === l.id)) return l;
    const host = accounts.find((a) => a.plaidAliases?.some((p) => p.linkId === l.id));
    return host ? { ...l, duplicateOf: host.plaid!.linkId } : l;
  });

  return {
    merged: into.size,
    data: {
      ...d,
      accounts,
      transactions,
      bankLinks,
      bills: d.bills.map((b) => (into.has(b.accountId) ? { ...b, accountId: re(b.accountId) } : b)),
      recurring: d.recurring.map((f) =>
        f.accountIds.some((id) => into.has(id)) ? { ...f, accountIds: [...new Set(f.accountIds.map(re))], occurrences: f.occurrences.map((o) => ({ ...o, accountId: re(o.accountId) })) } : f,
      ),
    },
  };
}

/**
 * Owner's stated corrections, applied once. Each must match exactly one record
 * on several facts (not the last 4 alone); after that the account's own id
 * carries the assignment. Victor, 2026-10-24: the checking account ending 5443
 * (no live connection, filled from statements) is Gladiator's, not Maverick's.
 */
const CORRECTIONS: { match: (a: Account, d: MoneyData) => boolean; entity: Scope }[] = [
  {
    match: (a, d) => a.last4 === "5443" && a.type === "checking" && (!a.plaid || !d.bankLinks.some((l) => l.id === a.plaid!.linkId)),
    entity: "gladiator",
  },
];

/**
 * Version 1 of the account rules: a company is kept only where it was clearly
 * chosen (moved away from what its connection defaulted to, or set by you);
 * everything else becomes "needs assignment". Then the stated corrections.
 */
export function migrateEntities(d: MoneyData, now = new Date().toISOString()): { data: MoneyData; unassigned: number; corrected: string[] } {
  if ((d.accountRules ?? 0) >= ACCOUNT_RULES) return { data: d, unassigned: 0, corrected: [] };
  const links = new Map(d.bankLinks.map((l) => [l.id, l]));
  let unassigned = 0;
  let accounts = d.accounts.map((a): Account => {
    if (a.entitySetAt || a.needsEntity) return a;
    const link = a.plaid ? links.get(a.plaid.linkId) : undefined;
    const chosen = !!link && !!a.scope && a.scope !== (link.scope ?? "personal");
    if (chosen) return { ...a, entitySetAt: now };
    unassigned++;
    return { ...a, needsEntity: true };
  });
  const corrected: string[] = [];
  const moved = new Map<string, Scope>();
  for (const c of CORRECTIONS) {
    const hits = accounts.filter((a) => c.match(a, d));
    if (hits.length !== 1) continue; // ambiguous or gone: leave it for you to assign
    const id = hits[0].id;
    if (hits[0].needsEntity) unassigned--;
    accounts = accounts.map((a) => (a.id === id ? { ...a, scope: c.entity, needsEntity: undefined, entitySetAt: now } : a));
    moved.set(id, c.entity);
    corrected.push(id);
  }
  return {
    unassigned,
    corrected,
    data: {
      ...d,
      accounts,
      // Bills you set up on a corrected account follow it.
      bills: d.bills.map((b) => (moved.has(b.accountId) ? { ...b, scope: moved.get(b.accountId) } : b)),
      // Recurring bills found on it follow it too (they're refound on the next scan).
      recurring: d.recurring.map((f) => {
        const to = f.accountIds.map((id) => moved.get(id)).find(Boolean);
        return to ? { ...f, scope: to, overrides: f.overrides?.scope ? { ...f.overrides, scope: to } : f.overrides } : f;
      }),
      billScan: corrected.length ? undefined : d.billScan,
      accountRules: ACCOUNT_RULES,
    },
  };
}

/** Assigns an account to a company, from the Accounts screen. */
export function assignEntity(d: MoneyData, accountId: string, entity: Scope, now = new Date().toISOString()): MoneyData {
  return {
    ...d,
    accounts: d.accounts.map((a) => (a.id === accountId ? { ...a, scope: entity, needsEntity: undefined, entitySetAt: now } : a)),
    billScan: undefined, // refind its bills under the right company
  };
}

/** Dedupe, then the account rules. Returns counts for the logs (never amounts). */
export function cleanAccounts(d: MoneyData) {
  const before = d.accounts.length;
  const a = dedupeAccounts(d);
  const b = migrateEntities(a.data);
  return { data: b.data, before, after: b.data.accounts.length, merged: a.merged, unassigned: b.unassigned, corrected: b.corrected, changed: a.merged > 0 || b.data !== a.data };
}

/** The money data with unassigned accounts (and their transactions) left out, for company totals. */
export function assignedOnly(d: MoneyData): MoneyData {
  if (!d.accounts.some((a) => a.needsEntity)) return d;
  const out = new Set(d.accounts.filter((a) => a.needsEntity).map((a) => a.id));
  return {
    ...d,
    accounts: d.accounts.filter((a) => !out.has(a.id)),
    transactions: d.transactions.filter((t) => !out.has(t.accountId)),
    recurring: d.recurring.filter((f) => f.accountIds.some((id) => !out.has(id))),
  };
}
