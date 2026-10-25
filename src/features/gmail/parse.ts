import type { Scope } from "@/features/money/types";

/*
 * Turns one Gmail message into a bill or receipt, or into nothing. Only
 * messages that read like a bill or a receipt are kept, and only the facts
 * below are saved: who sent it, the amount, and dates the email states
 * outright. The rest of the message is thrown away.
 *
 * An email bill is what a company says you owe or paid. It is not a bank
 * debit: the date money actually came out only ever comes from the bank.
 */

export type EmailKind = "bill" | "receipt";
export type EmailStatus = "review" | "confirmed" | "ignored" | "duplicate";

export type EmailItem = {
  id: string; // Gmail's message id, used for the "Open in Gmail" link
  kind: EmailKind;
  merchant: string;
  fromDomain: string;
  subject: string;
  amount: number | null;
  currency: string;
  billDate: string | null; // statement, invoice or receipt date, only when the email says it
  dueDate: string | null; // only when the email says it
  emailDate: string; // the day the email arrived
  evidence: string; // the short line the amount came from, to check it against
  flags: string[]; // why it needs a closer look
  status: EmailStatus;
  duplicateOf?: string;
  scope?: Scope; // the company you assigned
  billId?: string; // the saved bill it was added as or linked to
  foundAt: string;
};

export type MailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: MailPart[];
};

export type RawMessage = { id: string; internalDate?: string; payload?: MailPart };

/* ---- Message text ---- */

const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#36": "$", dollar: "$" };

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k]) return ENTITIES[k];
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
      return m;
    });
}

/** The message's readable text: its plain-text part, else its HTML part as text. Attachments are skipped. */
export function messageText(part: MailPart | undefined): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: MailPart | undefined) => {
    if (!p || p.filename) return;
    if (p.mimeType === "text/plain" && p.body?.data) plain.push(decode(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data) html.push(htmlToText(decode(p.body.data)));
    p.parts?.forEach(walk);
  };
  walk(part);
  const text = plain.join("\n").trim() || html.join("\n");
  return text.replace(/[ \t ​-‍]+/g, " ").replace(/\s*\n\s*/g, "\n").slice(0, 60_000);
}

export const header = (p: MailPart | undefined, name: string) => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

/* ---- Who sent it ---- */

const GENERIC_SENDER = /^(no[-_. ]?reply|do[-_. ]?not[-_. ]?reply|notifications?|alerts?|billing|bills?|payments?|customer ?(care|service|support)|support|info|accounts?|service|statements?|receipts?|orders?|mail|e?mail ?(team)?|team)$/i;

/** The sending company's main web domain, e.g. "billing@email.example.com" -> "example.com". */
export function mainDomain(address: string) {
  const host = (address.split("@")[1] ?? address).toLowerCase().replace(/[>\s].*$/, "");
  const labels = host.split(".").filter(Boolean);
  const twoPart = /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 2] ?? "") && (labels[labels.length - 1] ?? "").length === 2;
  return labels.slice(twoPart ? -3 : -2).join(".");
}

export function sender(from: string) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  const address = (m ? m[2] : from).trim();
  const domain = mainDomain(address);
  let name = (m?.[1] ?? "").replace(/\s+via\s+.*$/i, "").replace(/\s*[|,-]\s*(no[- ]?reply|notifications?|billing|alerts?)\s*$/i, "").trim();
  if (!name || GENERIC_SENDER.test(name) || name.includes("@")) {
    const label = domain.split(".")[0] ?? "";
    name = label ? label[0].toUpperCase() + label.slice(1) : "Unknown sender";
  }
  return { merchant: name.slice(0, 80), domain };
}

/* ---- Is it a bill or a receipt? ---- */

const RECEIPT = /\b(receipt|payment (received|confirmation|confirmed|processed|posted|successful|scheduled)|thank(s| you) for your (payment|order|purchase)|order (confirmation|confirmed)|you(?:'ve| have)? paid|we('ve)? received your payment|(has been|was|been) charged|charged to your|your order)\b/i;
const BILL = /\b(amount due|total due|balance due|payment (is )?due|due date|minimum payment|(new |your )?statement (is )?(ready|available)|new statement|e-?statement|(your )?bill (is )?(ready|available)|your (monthly |new )?bill|invoice|auto-?pay (is )?(scheduled|reminder|set)|upcoming payment|payment reminder|premium (is )?due|renewal)\b/i;
const NOISE = /(\d+% off|\bsale\b|\bdeals?\b|\boffers?\b|\bcoupon|\bsave \$|\bwebinar|\bnewsletter|\bverification code|\bsecurity (code|alert)|\bpassword|\bsign[- ]in|\blog[- ]?in\b|\bshipped\b|\bout for delivery|\bdelivered\b|\bsurvey\b|\breview your)/i;

export function kindOf(subject: string, text: string): EmailKind | null {
  const head = `${subject}\n${text.slice(0, 3000)}`;
  const receipt = RECEIPT.test(head);
  const bill = BILL.test(head);
  if (NOISE.test(subject) && !RECEIPT.test(subject) && !BILL.test(subject)) return null;
  // "Thank you for your payment" is a receipt even when it repeats the amount that was due.
  if (receipt && (!bill || RECEIPT.test(subject) || /thank(s| you) for your payment|payment (received|confirmation|posted)/i.test(head))) return "receipt";
  if (bill) return "bill";
  return null;
}

/* ---- Amounts ---- */

const MONEY = /(US\$|CA\$|C\$|\$|€|£|\b(?:USD|EUR|GBP|CAD)\s?)\s?(\d{1,3}(?:,\d{3})+|\d{1,6})(\.\d{2})?(?!\d)|(\d{1,3}(?:,\d{3})+|\d{1,6})\.(\d{2})\s?(USD|EUR|GBP|CAD)\b/g;
const CURRENCY: Record<string, string> = { $: "USD", US$: "USD", USD: "USD", "€": "EUR", EUR: "EUR", "£": "GBP", GBP: "GBP", CA$: "CAD", C$: "CAD", CAD: "CAD" };

// Lower is better. Labels that say what the amount is beat a bare number. Checked in order, so
// "minimum payment due" is read as a minimum before "payment due" can claim it.
const LABELS: [RegExp, number, string?][] = [
  [/(minimum (payment )?due|minimum payment|min\.? payment)\W*$/i, 3, "Only a minimum payment was found; the full balance may differ."],
  [/(total amount due|amount due|total due|balance due|payment due|new balance|statement balance|amount owed|please pay|total balance|current balance due|premium due|amount to be (debited|charged|drafted)|auto-?pay amount|scheduled (payment )?amount)\W*$/i, 1],
  [/(amount paid|payment amount|you paid|total charged|amount charged|charged|order total|grand total|total paid|payment of|paid)\W*$/i, 1],
  [/(total|amount|balance|subtotal)\W*$/i, 2],
];

type Candidate = { amount: number; currency: string; rank: number; line: string; note?: string };

export function amounts(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(MONEY)) {
    const symbol = (m[1] ?? m[6] ?? "").trim();
    const whole = m[2] ?? m[4];
    const cents = m[3] ?? (m[5] ? `.${m[5]}` : "");
    const amount = Number(`${whole.replace(/,/g, "")}${cents}`);
    if (!(amount > 0) || amount >= 1_000_000) continue;
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 60), start).split("\n").slice(-2).join(" ");
    const lineStart = text.lastIndexOf("\n", start) + 1;
    const lineEnd = text.indexOf("\n", start);
    const line = text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim().slice(0, 140);
    // Credits, savings and limits aren't what you owe.
    if (/(credit limit|available credit|you saved|savings|discount|rewards?|cash ?back|points|off)\W*$/i.test(before)) continue;
    const hit = LABELS.find(([rx]) => rx.test(before));
    out.push({ amount, currency: CURRENCY[symbol] ?? "USD", rank: hit ? hit[1] : 4, line, note: hit?.[2] });
  }
  return out;
}

export function pickAmount(text: string): { amount: number | null; currency: string; evidence: string; flags: string[] } {
  const all = amounts(text);
  if (!all.length) return { amount: null, currency: "USD", evidence: "", flags: ["No amount found in the email."] };
  const best = Math.min(...all.map((c) => c.rank));
  const top = all.filter((c) => c.rank === best);
  const values = [...new Set(top.map((c) => c.amount))];
  const flags: string[] = [];
  if (values.length > 1) flags.push("The email shows more than one amount; check which one is the bill.");
  if (best === 4) flags.push("The amount wasn't labeled as a total or amount due.");
  if (top[0].note) flags.push(top[0].note);
  return { amount: top[0].amount, currency: top[0].currency, evidence: top[0].line, flags };
}

/* ---- Dates the email states ---- */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE =
  /\b(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?|(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b|(\d{4})-(\d{2})-(\d{2}))/i;

const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** The date at the start of `s`, as YYYY-MM-DD. A missing year is taken from the email's date (flagged). */
export function readDate(s: string, emailDate: string): { date: string; yearGuessed: boolean } | null {
  const m = DATE.exec(s.slice(0, 40));
  if (!m || (m.index ?? 0) > 12) return null;
  let y: number, mo: number, d: number;
  let guessed = false;
  if (m[1]) {
    mo = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    d = Number(m[2]);
    if (m[3]) y = Number(m[3]);
    else {
      // The year that puts the date closest to when the email came.
      const base = Number(emailDate.slice(0, 4));
      const near = [base - 1, base, base + 1].map((yy) => ({ yy, gap: Math.abs(Date.UTC(yy, mo - 1, d) - Date.parse(`${emailDate}T00:00:00Z`)) }));
      y = near.sort((a, b) => a.gap - b.gap)[0].yy;
      guessed = true;
    }
  } else if (m[4]) {
    mo = Number(m[4]);
    d = Number(m[5]);
    y = Number(m[6].length === 2 ? `20${m[6]}` : m[6]);
  } else {
    y = Number(m[7]);
    mo = Number(m[8]);
    d = Number(m[9]);
  }
  if (!valid(y, mo, d) || y < 2000 || y > 2100) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, yearGuessed: guessed };
}

const DUE_LABEL = /\b(?:payment due date|due date|payment due|due on|due by|is due(?: on)?|due|will be (?:debited|drafted|charged|withdrawn)(?: on)?|scheduled for|auto-?pay date)\b\s*(?:date)?\s*(?:is|:|-|on|by)?\s*/gi;
const BILL_LABEL = /\b(?:statement date|statement closing date|closing date|bill date|billing date|invoice date|order date|receipt date|payment date|date paid|paid on|transaction date|date of payment)\b\s*(?:is|:|-|on)?\s*/gi;

function labeledDate(text: string, label: RegExp, emailDate: string) {
  for (const m of text.matchAll(label)) {
    const found = readDate(text.slice((m.index ?? 0) + m[0].length), emailDate);
    if (found) return found;
  }
  return null;
}

/* ---- One message ---- */

export function extract(msg: RawMessage, foundAt: string): EmailItem | null {
  const p = msg.payload;
  const subject = header(p, "Subject").slice(0, 200);
  const { merchant, domain } = sender(header(p, "From"));
  const text = messageText(p);
  const kind = kindOf(subject, text);
  if (!kind) return null;
  const ms = Number(msg.internalDate);
  const emailDate = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.parse(header(p, "Date")) || Date.now()).toISOString().slice(0, 10);
  const body = `${subject}\n${text}`;
  const { amount, currency, evidence, flags } = pickAmount(body);
  const due = kind === "bill" ? labeledDate(body, DUE_LABEL, emailDate) : null;
  const billed = labeledDate(body, BILL_LABEL, emailDate);
  if (amount === null && !due) return null; // nothing usable: no amount and no due date
  if (due?.yearGuessed || billed?.yearGuessed) flags.push("The email left out the year; it was taken from when the email came.");
  return {
    id: msg.id,
    kind,
    merchant,
    fromDomain: domain,
    subject,
    amount,
    currency,
    billDate: billed?.date ?? null,
    dueDate: due?.date ?? null,
    emailDate,
    evidence,
    flags,
    status: "review",
    foundAt,
  };
}

/* ---- Keeping one copy ---- */

const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

function sameBill(a: EmailItem, b: EmailItem) {
  if (a.kind !== b.kind || a.fromDomain !== b.fromDomain || a.amount === null || a.amount !== b.amount) return false;
  if (a.dueDate && b.dueDate) return a.dueDate === b.dueDate;
  return dayGap(a.emailDate, b.emailDate) <= 3;
}

/**
 * Adds newly found emails to what's already saved. A message already saved is
 * never changed, so your decisions stick. A new email for the same bill (same
 * sender, kind and amount, and the same due date or within 3 days) is kept
 * but marked as a duplicate of the first one.
 */
export function mergeFound(saved: EmailItem[], found: EmailItem[]): { items: EmailItem[]; added: number; duplicates: number } {
  const ids = new Set(saved.map((i) => i.id));
  const items = [...saved];
  let added = 0;
  let duplicates = 0;
  for (const f of [...found].sort((a, b) => a.emailDate.localeCompare(b.emailDate))) {
    if (ids.has(f.id)) continue;
    ids.add(f.id);
    const first = items.find((i) => i.status !== "duplicate" && i.status !== "ignored" && sameBill(i, f));
    if (first) {
      items.push({ ...f, status: "duplicate", duplicateOf: first.id });
      duplicates++;
    } else {
      items.push(f);
      added++;
    }
  }
  items.sort((a, b) => b.emailDate.localeCompare(a.emailDate));
  return { items, added, duplicates };
}
