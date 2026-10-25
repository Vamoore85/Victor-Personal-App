import { EMPTY_DATA, type Bill, type MoneyData, type Scope } from "@/features/money/types";

/*
 * Bills you confirmed from a workbook, delivered through the PENDING_BILLS
 * environment variable in Vercel instead of the (public) code repository.
 * Format: {"bills": [[scope, last4 of the paying account, name, monthly amount, day of month, category, autopay, website?, note?], ...],
 *          "check": {"count", "total"}}.
 * Added to Bills the next time the app loads. Each bill is added once: one
 * already there under the same company is skipped, and one you delete later
 * isn't brought back (billImports remembers it), so it is safe to leave set.
 */

type Row = [Scope, string, string, number, number, string, boolean, string?, string?];
type Pending = { bills: Row[]; check?: { count: number; total: number } };

const SCOPES: Scope[] = ["personal", "business", "gladiator"];
const cents = (n: number) => Math.round(n * 100) / 100;

function pending(raw: string | undefined): Pending | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Pending;
    if (!Array.isArray(p.bills) || p.bills.some((r) => !SCOPES.includes(r[0]) || typeof r[3] !== "number" || !(r[4] >= 1 && r[4] <= 31))) {
      console.error("PENDING_BILLS has a bad row");
      return null;
    }
    const total = cents(p.bills.reduce((s, r) => s + r[3], 0));
    if (p.check && (p.bills.length !== p.check.count || Math.abs(total - p.check.total) > 0.005)) {
      console.error("PENDING_BILLS failed its check", p.bills.length, total);
      return null;
    }
    return p;
  } catch {
    console.error("PENDING_BILLS isn't valid JSON");
    return null;
  }
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/);
const importKey = (scope: Scope, name: string) => `${scope}|${words(name).join(" ")}`;

/** A bill you already have: same company, and the same name, or the same first word at about the same amount. */
function alreadyThere(bills: Bill[], scope: Scope, name: string, amount: number) {
  const w = words(name);
  return bills.some((b) => {
    if ((b.scope ?? "personal") !== scope) return false;
    const v = words(b.name);
    return v.join(" ") === w.join(" ") || (v[0] === w[0] && Math.abs(b.amount - amount) <= 1);
  });
}

/** The next date on `day` (clamped to short months), today or later. */
export function nextOnDay(day: number, today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const on = (yy: number, mm: number) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
  };
  const here = on(y, m);
  if (Number(here.slice(8)) >= d) return here;
  return m === 12 ? on(y + 1, 1) : on(y, m + 1);
}

/** Returns the data with the new bills added, or null when there's nothing new. */
export function applyPendingBills(current: unknown, today = new Date().toISOString().slice(0, 10), raw?: string): { data: MoneyData; added: number } | null {
  const p = pending(raw ?? process.env.PENDING_BILLS);
  if (!p) return null;
  const base = { ...EMPTY_DATA, ...((current as Partial<MoneyData>) ?? {}) } as MoneyData;
  const done = new Set(base.billImports ?? []);
  const bills = [...(base.bills ?? [])];
  const imports = [...done];
  let added = 0;
  for (const [scope, last4, name, amount, day, category, autopay, url, note] of p.bills) {
    const k = importKey(scope, name);
    if (done.has(k)) continue;
    done.add(k);
    imports.push(k);
    if (alreadyThere(bills, scope, name, amount)) continue;
    const accounts = (base.accounts ?? []).filter((a) => a.last4 === last4 && a.type === "checking");
    const account = accounts.find((a) => a.plaid) ?? accounts[0];
    bills.push({
      id: `wb-${k.replace(/[^a-z0-9]+/g, "-")}`,
      name,
      amount: cents(amount),
      category,
      frequency: "monthly",
      nextDue: nextOnDay(day, today),
      dueDay: day,
      accountId: account?.id ?? "",
      autopay,
      ...(url ? { url: `https://${url.replace(/^https?:\/\//, "")}` } : {}),
      scope,
      note: note ? `From your bills workbook. ${note}` : "From your bills workbook.",
    });
    added++;
  }
  if (imports.length === (base.billImports ?? []).length) return null;
  return { data: { ...base, bills, billImports: imports }, added };
}
