import { addDays, today as todayYmd } from "./calc";
import { bucketLabel, bucketOf, bucketReport, cashAccounts, effective, nextMonthRollup, reportWindow, FRESH_HOURS, type Bucket, type BucketReport, type CashAccount } from "./bill-intel";
import { DEFAULT_SPEND_OPTIONS, spendReport, type SpendReport } from "./spend";
import type { BriefingSnapshot, MoneyData } from "./types";

/*
 * The Financial Briefing: one page per owner, built from the latest bank
 * sync. It is made fresh from the money data every time it's shown, and a
 * short copy is saved after each sync so you can look back. It only calls
 * itself current when every connected bank synced recently, completely and
 * without errors; otherwise it says what's missing.
 */

export const HISTORY_DONE = "HISTORICAL_UPDATE_COMPLETE";

export type Freshness = "current" | "partial" | "stale" | "failed" | "no-bank";

export type Flag = { tone: "bad" | "warn" | "info"; text: string };

export type OwnerBriefing = {
  bucket: Bucket;
  cash: CashAccount[];
  cards: { name: string; owed: number | null; asOf: string | null }[];
  available: number | null;
  ytd: SpendReport;
  today: BucketReport;
  week: BucketReport;
  month: BucketReport;
  next: { date: string; name: string; amount: number; confirmed: boolean }[];
  nextMonth: ReturnType<typeof nextMonthRollup>;
  highlights: string[];
  flags: Flag[];
};

export type Briefing = {
  generatedAt: string;
  date: string;
  freshness: Freshness;
  freshnessText: string;
  lastSync: string | null;
  owners: OwnerBriefing[];
};

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const hours = (iso: string | undefined | null, now: number) => (iso ? (now - new Date(iso).getTime()) / 3600000 : Infinity);

/** How much to trust today's numbers, from the state of every connected bank. */
export function freshness(d: MoneyData, now = Date.now()): { freshness: Freshness; text: string; lastSync: string | null } {
  const links = d.bankLinks;
  if (links.length === 0) return { freshness: "no-bank", text: "No bank is connected, so this uses statements and typed-in data only.", lastSync: null };
  const syncs = links.map((l) => l.lastSync).filter((x): x is string => !!x).sort();
  const lastSync = syncs[syncs.length - 1] ?? null;
  const failed = links.filter((l) => l.error);
  if (failed.length) return { freshness: "failed", text: `Last sync failed for ${failed.map((l) => l.institution || "a bank").join(", ")}. Numbers below are from before that.`, lastSync };
  const stale = links.filter((l) => hours(l.lastSync, now) > FRESH_HOURS);
  if (stale.length) return { freshness: "stale", text: `${stale.map((l) => l.institution || "A bank").join(", ")} hasn't synced in over a day. Press Sync now for current numbers.`, lastSync };
  const loading = links.filter((l) => l.historyStatus !== HISTORY_DONE);
  if (loading.length)
    return { freshness: "partial", text: `Plaid is still loading older history for ${loading.map((l) => l.institution || "a bank").join(", ")}, so year-to-date totals may be low.`, lastSync };
  return { freshness: "current", text: "Every connected bank synced in the last day, with its full history.", lastSync };
}

export function ownerBriefing(d: MoneyData, bucket: Bucket, t = todayYmd(), now = Date.now()): OwnerBriefing {
  const ytd = spendReport(d, bucket, "ytd", DEFAULT_SPEND_OPTIONS, t);
  const w = (k: "day" | "week" | "month") => reportWindow(k, t);
  const todayR = bucketReport(d, bucket, t, t, t, now);
  const week = bucketReport(d, bucket, w("week").start, w("week").end, t, now);
  const month = bucketReport(d, bucket, w("month").start, w("month").end, t, now);
  const cash = cashAccounts(d, bucket, now);
  const cards = d.accounts
    .filter((a) => bucketOf(a.scope) === bucket && (a.type === "credit" || a.type === "loan"))
    .map((a) => ({ name: a.name, owed: a.bankBalance?.current ?? null, asOf: a.bankBalance?.asOf ?? null }));

  // The next withdrawals look a bit further ahead, so a bill just past 30 days still shows.
  const ahead = bucketReport(d, bucket, t, addDays(t, 59), t, now);
  const next = ahead.lines
    .filter((l) => l.status === "scheduled" || l.status === "possible")
    .slice(0, 6)
    .map((l) => ({ date: l.date, name: l.name, amount: l.amount, confirmed: l.status === "scheduled" }));

  const highlights: string[] = [];
  const topCat = ytd.byCategory[0];
  const topPayee = ytd.byMerchant[0];
  if (topCat) highlights.push(`Biggest category this year: ${topCat.name}, ${fmt(topCat.amount)} (${Math.round(topCat.share * 100)}% of spending).`);
  if (topPayee) highlights.push(`Most paid to: ${topPayee.name}, ${fmt(topPayee.amount)} across ${topPayee.count} payments.`);
  if (ytd.compare?.change != null) highlights.push(`Spending is ${ytd.compare.change >= 0 ? "up" : "down"} ${Math.abs(Math.round(ytd.compare.change * 100))}% on the same dates last year.`);
  const recent = spendReport(d, bucket, "30", DEFAULT_SPEND_OPTIONS, t);
  const big = recent.rows.filter((r) => !r.obligation).sort((a, b) => b.amount - a.amount)[0];
  if (big) highlights.push(`Largest everyday charge in the last 30 days: ${big.merchant}, ${fmt(big.amount)} on ${big.t.date}.`);

  const flags: Flag[] = [];
  if (month.alert === "short") flags.push({ tone: "bad", text: `Bills in the next 30 days (${fmt(month.outgoing)}) are more than the money available.` });
  else if (week.alert === "short") flags.push({ tone: "bad", text: `Bills this week (${fmt(week.outgoing)}) are more than the money available.` });
  else if (month.alert === "tight" || week.alert === "tight") flags.push({ tone: "warn", text: `Tight: only ${fmt((month.alert === "tight" ? month : week).projected ?? 0)} left after bills.` });
  if (month.overdue) flags.push({ tone: "bad", text: `${month.overdue} bill${month.overdue === 1 ? " is" : "s are"} past due.` });
  const stale = cash.filter((c) => c.status !== "live");
  if (cash.length && stale.length === cash.length) flags.push({ tone: "warn", text: "No checking or savings account has a bank balance from the last day, so there's no after-bills figure." });
  else if (stale.length) flags.push({ tone: "info", text: `${stale.map((c) => c.account.name).join(", ")}: balance not current, not counted.` });
  if (!cash.length) flags.push({ tone: "warn", text: `No checking or savings account is assigned to ${bucketLabel(bucket)}.` });
  if (!ytd.cover.first) flags.push({ tone: "warn", text: "No transactions this year yet." });
  else if (!ytd.cover.full) flags.push({ tone: "warn", text: `History only starts ${ytd.cover.first}, so the year-to-date total is partial.` });
  const unassigned = d.accounts.filter((a) => bucketOf(a.scope) === bucket && a.plaid && !a.scope);
  if (unassigned.length) flags.push({ tone: "warn", text: `${unassigned.map((a) => a.name).join(", ")} has no owner set and is counted as Personal. Check it on Accounts.` });
  const review = d.recurring.filter((f) => f.status === "review" && effective(f).bucket === bucket).length;
  if (review) flags.push({ tone: "info", text: `${review} possible recurring payment${review === 1 ? "" : "s"} waiting for review under Bills.` });

  return {
    bucket,
    cash,
    cards,
    available: month.available,
    ytd,
    today: todayR,
    week,
    month,
    next,
    nextMonth: nextMonthRollup(d, bucket, t),
    highlights,
    flags,
  };
}

export function buildBriefing(d: MoneyData, t = todayYmd(), now = Date.now()): Briefing {
  const f = freshness(d, now);
  return {
    generatedAt: new Date(now).toISOString(),
    date: t,
    freshness: f.freshness,
    freshnessText: f.text,
    lastSync: f.lastSync,
    owners: (["pm", "gladiator"] as const).map((b) => ownerBriefing(d, b, t, now)),
  };
}

export const FRESHNESS_LABEL: Record<Freshness, string> = {
  current: "Current",
  partial: "Partial history",
  stale: "Not current",
  failed: "Sync failed",
  "no-bank": "No bank connected",
};

/** The whole briefing as plain text, for copying, printing or saving. */
export function briefingPlainText(b: Briefing) {
  const out = [
    `MAVERICK FINANCIAL BRIEFING · ${b.date}`,
    `Status: ${FRESHNESS_LABEL[b.freshness]}. ${b.freshnessText}`,
    b.lastSync ? `Last bank sync: ${new Date(b.lastSync).toLocaleString("en-US")}` : "",
  ].filter(Boolean);
  for (const o of b.owners) {
    out.push("", bucketLabel(o.bucket).toUpperCase(), "-".repeat(bucketLabel(o.bucket).length));
    out.push(o.available === null ? "Available now: no current bank balance" : `Available now: ${fmt(o.available)}`);
    for (const c of o.cash)
      out.push(`  ${c.account.name}: ${c.status === "live" ? `${fmt(c.balance ?? 0)} ${c.kind}, as of ${new Date(c.asOf!).toLocaleString("en-US")}` : c.status === "unlinked" ? "not linked" : "not current, not counted"}`);
    for (const c of o.cards) out.push(`  ${c.name}: ${c.owed === null ? "no balance" : `${fmt(c.owed)} owed`}`);
    out.push(`Bills due today ${fmt(o.today.outgoing)} · this week ${fmt(o.week.outgoing)} · next 30 days ${fmt(o.month.outgoing)}`);
    if (o.month.projected !== null) out.push(`After the next 30 days of bills: ${fmt(o.month.projected)}`);
    if (o.next.length) {
      out.push("Next withdrawals:");
      for (const n of o.next) out.push(`  ${n.date}  ${n.name}  ${fmt(n.amount)}${n.confirmed ? "" : " (predicted, not confirmed)"}`);
    }
    out.push(`Spent this year: ${fmt(o.ytd.total)} (${o.ytd.count} transactions${o.ytd.cover.first ? `, history ${o.ytd.cover.first} to ${o.ytd.cover.last}` : ""})`);
    for (const g of o.ytd.byMerchant.slice(0, 5)) out.push(`  ${g.name}: ${fmt(g.amount)}`);
    for (const h of o.highlights) out.push(`• ${h}`);
    for (const f of o.flags) out.push(`! ${f.text}`);
  }
  return out.join("\n");
}

/** A short saved copy: the headline numbers and the text. */
export function snapshotOf(b: Briefing, trigger: BriefingSnapshot["trigger"]): BriefingSnapshot {
  return {
    id: b.generatedAt,
    at: b.generatedAt,
    trigger,
    freshness: b.freshness,
    owners: b.owners.map((o) => ({ bucket: o.bucket, available: o.available, ytdSpend: o.ytd.total, billsMonth: o.month.outgoing, projected: o.month.projected, flags: o.flags.length })),
    text: briefingPlainText(b),
  };
}

const KEEP = 60;

/**
 * Saves a fresh briefing after a sync. One within ten minutes of the last is
 * replaced rather than added, so a multi-bank sync leaves one entry.
 */
export function saveBriefing(d: MoneyData, trigger: BriefingSnapshot["trigger"], t = todayYmd(), now = Date.now()): MoneyData {
  const snap = snapshotOf(buildBriefing(d, t, now), trigger);
  const prev = d.briefings[0];
  const replace = prev && now - new Date(prev.at).getTime() < 10 * 60 * 1000;
  const keepTrigger = replace && prev.trigger === "first-sync" ? "first-sync" : trigger;
  const briefings = [{ ...snap, trigger: keepTrigger }, ...(replace ? d.briefings.slice(1) : d.briefings)].slice(0, KEEP);
  return { ...d, briefings };
}

