import type { Bill, BillFrequency, MoneyData, Scope } from "@/features/money/types";
import { matchingBills, suggestScope } from "./match";
import type { EmailItem } from "./parse";

export type EmailRecurringBill = {
  key: string; name: string; frequency: BillFrequency; evidence: string;
  latest: EmailItem; emailIds: string[]; scope: Scope | null; billId?: string;
  findingId?: string;
  reason: string; ready: boolean;
};

const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86400000;
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const vendor = (s: string) => clean(s.replace(/\b(notifications?|billing|statements?|credit card)\b/gi,""));
const gateway = /^(paypal|stripe|squareup|square|intuit)\.com$/;

/** Require a billing statement of cadence, or at least three distinct, regularly spaced bills. */
export function explicitCadence(text: string): BillFrequency | null {
  const patterns: [BillFrequency, RegExp][] = [
    ["biweekly", /\b(billed|charged|payment|billing)\b[^.\n]{0,25}\bevery (two|2) weeks\b/i],
    ["weekly", /\b(weekly (bill|payment|subscription)|billed weekly|charged weekly)\b/i],
    ["monthly", /\b(monthly (bill|payment|subscription|invoice)|billed monthly|charged monthly|renews (each|every) month)\b/i],
    ["quarterly", /\b(quarterly (bill|payment|subscription|invoice)|billed quarterly|charged quarterly)\b/i],
    ["yearly", /\b((annual|yearly) (bill|payment|subscription|invoice|renewal)|billed annually|charged annually|renews (each|every) year)\b/i],
  ];
  return patterns.find(([, re]) => re.test(text))?.[0] ?? null;
}

function cadence(items: EmailItem[]): { frequency: BillFrequency; evidence: string } | null {
  const explicit = items.map(i => i.recurringFrequency ?? explicitCadence(i.subject)).filter((x): x is BillFrequency => Boolean(x));
  if (new Set(explicit).size === 1) return { frequency: explicit[0], evidence: "The bill states a repeating billing schedule." };
  if (new Set(explicit).size > 1) return null;
  const dates = [...new Set(items.map(i => i.dueDate ?? i.billDate).filter((x): x is string => Boolean(x)))].sort();
  if (dates.length < 3) return null;
  const gaps = dates.slice(1).map((d, n) => day(d) - day(dates[n]));
  const bands: [BillFrequency, number, number][] = [["weekly",5,9],["biweekly",12,16],["monthly",25,35],["quarterly",80,100],["yearly",330,400]];
  const band = bands.find(([, lo, hi]) => gaps.every(g => g >= lo && g <= hi));
  return band ? { frequency: band[0], evidence: `${dates.length} bills with regularly spaced billing dates.` } : null;
}

export function recurringEmailBills(items: EmailItem[], data: MoneyData, today: string): EmailRecurringBill[] {
  const groups = new Map<string, EmailItem[]>();
  for (const item of items) {
    if (item.kind !== "bill" || item.status === "ignored" || item.status === "duplicate" || gateway.test(item.fromDomain)) continue;
    const key = `${item.fromDomain}:${clean(item.merchant)}:${item.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const out: EmailRecurringBill[] = [];
  for (const [key, group] of groups) {
    const repeat = cadence(group);
    if (!repeat) continue;
    const sorted = [...group].sort((a,b) => (b.dueDate ?? b.billDate ?? b.emailDate).localeCompare(a.dueDate ?? a.billDate ?? a.emailDate));
    const latest = sorted[0];
    const billingDates = [...new Set(group.map(i => i.dueDate ?? i.billDate).filter((x): x is string => Boolean(x)))].sort();
    const minimumGap: Record<BillFrequency, number> = { once:0,weekly:5,biweekly:12,monthly:25,quarterly:80,yearly:330 };
    const overlapping = billingDates.slice(1).some((d,n) => day(d) - day(billingDates[n]) < minimumGap[repeat.frequency]);
    const scopes = [...new Set(group.map(i => i.scope).filter((s): s is Scope => Boolean(s)))];
    const bankOwnerScopes = [...new Set(data.recurring.filter(f => f.direction === "out" && vendor(f.merchant) === vendor(latest.merchant) && f.accountIds.length > 0 && f.accountIds.every(id => {
      const account = data.accounts.find(a=>a.id === id);
      return account && !account.needsEntity && (account.scope ?? "personal") === f.scope;
    })).map(f=>f.scope))];
    const hint = suggestScope(latest, data.institutions, data.bills).scope;
    const possibleScopes = [...new Set([...(hint ? [hint] : []),...bankOwnerScopes])];
    const scope = scopes.length === 1 ? scopes[0] : scopes.length > 1 ? null : possibleScopes.length === 1 ? possibleScopes[0] : null;
    const same = scope === null ? [] : matchingBills(latest, scope, data.bills);
    const matches = data.bills.filter(b => b.emailSource?.key === key || group.some(i => i.billId === b.id) || same.includes(b) || (scope !== null && (b.scope ?? "personal") === scope && clean(b.name) === clean(latest.merchant)));
    const bankMatches = data.recurring.filter(f => f.direction === "out" && f.scope === scope && vendor(f.merchant) === vendor(latest.merchant));
    const editedFinding = !matches.length && bankMatches.some(f => f.overrides && Object.keys(f.overrides).length > 0);
    const exact = matches.length === 1 && scopes.length <= 1 && !overlapping ? matches[0] : undefined;
    const validAmount = latest.currency === "USD" && latest.amount !== null && latest.amount > 0 && (!latest.flags.length || latest.status === "confirmed");
    const current = Boolean(latest.dueDate && latest.dueDate >= today);
    const removed = !exact && ((data.emailBillImports ?? []).includes(key) || bankMatches.some(f => f.status === "dismissed" || f.billId && !data.bills.some(b => b.id === f.billId)));
    const reason = overlapping ? "Multiple billing dates—check the plans or accounts" : exact ? "Linked to your saved bill" : removed ? "Previously removed from Bills" : editedFinding ? "Saved recurring entry has edits—check the details" : matches.length > 1 || bankMatches.length > 1 ? "Multiple saved bills match—check the account" : scope === null ? "Choose Personal, Maverick or Gladiator" : !validAmount ? "Check the amount or currency" : !latest.dueDate ? "Needs a due date" : !current ? "Historical bill—needs a current due date" : "Ready for Bills and calendar";
    out.push({ key, name: latest.merchant, ...repeat, latest, emailIds: group.map(i => i.id), scope, billId: exact?.id, findingId: bankMatches.length === 1 ? bankMatches[0].id : undefined, reason, ready: !exact && !removed && !overlapping && !editedFinding && matches.length === 0 && bankMatches.length <= 1 && scope !== null && validAmount && current });
  }
  return out.sort((a,b) => b.latest.emailDate.localeCompare(a.latest.emailDate));
}

/** Idempotent: link existing bills; add only clear, current, owned obligations. Never creates bank payments. */
export function applyRecurringEmails(data: MoneyData, items: EmailItem[], today: string): { data: MoneyData; added: number; linked: number } {
  let bills = data.bills;
  let recurring = data.recurring;
  const imported = new Set(data.emailBillImports ?? []);
  let added = 0, linked = 0;
  for (const candidate of recurringEmailBills(items, data, today)) {
    if (candidate.billId) {
      const index = bills.findIndex(b => b.id === candidate.billId);
      const bill = bills[index];
      // Preserve another email group's identity and every user-edited bill field.
      if (bill.emailSource && bill.emailSource.key !== candidate.key) continue;
      const ids = [...new Set([...(bill.emailSource?.ids ?? []), ...candidate.emailIds])].sort();
      if (bill.emailSource?.key === candidate.key && JSON.stringify(bill.emailSource.ids) === JSON.stringify(ids)) continue;
      bills = [...bills];
      bills[index] = { ...bill, emailSource: { ...bill.emailSource, key: candidate.key, ids, evidence: candidate.evidence } };
      imported.add(candidate.key); linked++;
    } else if (candidate.ready && candidate.scope && candidate.latest.amount !== null && candidate.latest.dueDate) {
      const bill: Bill = { id: `email:${candidate.key}`, name: candidate.name, amount: candidate.latest.amount, category: "Bills", frequency: candidate.frequency, nextDue: candidate.latest.dueDate, dueDay: Number(candidate.latest.dueDate.slice(8,10)), accountId: "", autopay: false, scope: candidate.scope, emailSource: { key: candidate.key, ids: [...candidate.emailIds].sort(), evidence: candidate.evidence, created: true }, note: "Recurring bill found in email. Due date and amount are expected; payment is verified separately from bank activity." };
      if (candidate.findingId) {
        bill.recurringId = candidate.findingId;
        recurring = recurring.map(f => f.id === candidate.findingId ? { ...f, status: "confirmed", billId: bill.id } : f);
      }
      bills = [...bills, bill]; imported.add(candidate.key); added++;
    }
  }
  return { data: added || linked ? { ...data, bills, recurring, emailBillImports: [...imported] } : data, added, linked };
}
