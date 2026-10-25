import type { EmailItem } from "@/features/gmail/parse";
import type { MoneyData, Receipt, Scope } from "@/features/money/types";

/*
 * Receipt folders: every receipt and bill you have, filed by year and then by
 * whose it is: Personal, Maverick or Gladiator. Anything not certain yet goes
 * in Needs review instead of being guessed: an email bill you haven't
 * confirmed, or a receipt photo with no company or no amount.
 *
 * Filing only reads. It never confirms an email, never changes a bill, and
 * never marks anything paid; "paid" only ever comes from the bank.
 */

export type Section = Scope | "review";
export const SECTIONS: Section[] = ["personal", "business", "gladiator", "review"];
export const SECTION_LABEL: Record<Section, string> = { personal: "Personal", business: "Maverick", gladiator: "Gladiator", review: "Needs review" };

export type FolderEntry = {
  key: string; // "email-<gmail id>" or "upload-<receipt id>"
  source: "email" | "upload";
  section: Section;
  year: string;
  date: string; // YYYY-MM-DD
  merchant: string;
  amount: number | null;
  kind: "bill" | "receipt";
  scope: Scope | null; // the company, when known
  why: string | null; // why it needs review
  subject?: string; // email only
  evidence?: string; // the line the amount came from (email only)
  flags: string[];
  gmailId?: string;
  messageId?: string;
  fileId?: string; // the uploaded file
  contentType?: string;
  note?: string;
};

const SCOPES: Scope[] = ["personal", "business", "gladiator"];
const isScope = (s: unknown): s is Scope => SCOPES.includes(s as Scope);

function fromEmail(i: EmailItem): FolderEntry | null {
  // "Not bills" and repeats of one already listed aren't receipts.
  if (i.status === "ignored" || i.status === "duplicate") return null;
  const date = i.billDate ?? i.emailDate;
  const sure = i.status === "confirmed" && isScope(i.scope);
  return {
    key: `email-${i.id}`,
    source: "email",
    section: sure ? i.scope! : "review",
    year: date.slice(0, 4),
    date,
    merchant: i.merchant,
    amount: i.amount,
    kind: i.kind,
    scope: isScope(i.scope) ? i.scope : null,
    why: sure ? null : i.status === "confirmed" ? "No company picked yet." : "Found in Gmail; not reviewed yet.",
    subject: i.subject,
    evidence: i.evidence,
    flags: i.flags,
    gmailId: i.id,
    ...(i.messageId ? { messageId: i.messageId } : {}),
  };
}

function fromUpload(r: Receipt): FolderEntry {
  const why = !isScope(r.scope) ? "No company picked yet." : r.amount === null ? "No amount typed yet." : null;
  return {
    key: `upload-${r.id}`,
    source: "upload",
    section: why ? "review" : r.scope!,
    year: r.date.slice(0, 4),
    date: r.date,
    merchant: r.merchant || "Receipt",
    amount: r.amount,
    kind: "receipt",
    scope: isScope(r.scope) ? r.scope : null,
    why,
    flags: r.transactionId ? [] : ["Not matched to a purchase yet."],
    fileId: r.id,
    contentType: r.contentType,
    note: r.note || undefined,
  };
}

/** Everything filed, newest first. */
export function buildFolders(money: Pick<MoneyData, "receipts">, emails: EmailItem[]): FolderEntry[] {
  const out = [...(money.receipts ?? []).map(fromUpload), ...emails.map(fromEmail).filter((x): x is FolderEntry => x !== null)];
  return out.filter((e) => /^\d{4}$/.test(e.year)).sort((a, b) => b.date.localeCompare(a.date) || a.merchant.localeCompare(b.merchant));
}

export type YearSummary = { year: string; sections: Record<Section, { count: number; total: number }> };

export function years(entries: FolderEntry[]): YearSummary[] {
  const by = new Map<string, YearSummary>();
  for (const e of entries) {
    let y = by.get(e.year);
    if (!y) {
      y = { year: e.year, sections: Object.fromEntries(SECTIONS.map((s) => [s, { count: 0, total: 0 }])) as YearSummary["sections"] };
      by.set(e.year, y);
    }
    const s = y.sections[e.section];
    s.count++;
    s.total = Math.round((s.total + (e.amount ?? 0)) * 100) / 100;
  }
  return [...by.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/* ---- The ZIP's layout ---- */

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const clean = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

/** "2026-10-20 Verizon 120.00" */
export function baseName(e: FolderEntry) {
  return [e.date, clean(e.merchant) || "Receipt", e.amount === null ? "" : e.amount.toFixed(2)].filter(Boolean).join(" ");
}

export const folderPath = (e: FolderEntry) => `${e.year}/${SECTION_LABEL[e.section]}`;

/** The name of the original inside the ZIP: the email as Gmail has it (.eml), or the file you uploaded. */
export const originalName = (e: FolderEntry) => `${folderPath(e)}/${baseName(e)}.${e.source === "email" ? "eml" : (EXT[e.contentType ?? ""] ?? "bin")}`;

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One row per receipt, for opening in a spreadsheet. `file` is the original's name in the ZIP, or why it's missing. */
export function indexCsv(rows: { e: FolderEntry; file: string }[]) {
  const head = ["Date", "Company", "Folder", "Store or sender", "Amount", "Kind", "Source", "Needs review because", "Email subject", "Amount line in email", "Notes", "Original file"];
  const lines = rows.map(({ e, file }) =>
    [
      e.date,
      e.scope ? SECTION_LABEL[e.scope] : "",
      SECTION_LABEL[e.section],
      e.merchant,
      e.amount === null ? "" : e.amount.toFixed(2),
      e.kind === "bill" ? "Bill" : "Receipt",
      e.source === "email" ? "Gmail" : "Uploaded",
      e.why ?? "",
      e.subject ?? "",
      e.evidence ?? "",
      [...e.flags, e.note ?? ""].filter(Boolean).join(" "),
      file,
    ]
      .map(cell)
      .join(","),
  );
  return `${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

export function readme(year: string, section: Section | null, missing: number, gmailNote: string | null) {
  return [
    `Maverick receipt folders: ${year}${section ? `, ${SECTION_LABEL[section]}` : ""}`,
    "",
    "Folders: Personal, Maverick and Gladiator hold receipts and bills you confirmed for that company.",
    "Needs review holds anything not certain yet: email bills you haven't reviewed, or receipts with no company or amount.",
    "",
    "Email originals are the .eml files exactly as Gmail has them. They open in Mail, Outlook or any email app.",
    "Uploaded receipts are the files as you saved them in Maverick.",
    "index.csv lists every item, with why it needs review and the original's file name.",
    "",
    "Nothing in this download is marked paid. An email bill says what a company asked for; the date money left your bank comes only from your bank.",
    ...(missing ? ["", `${missing} original${missing === 1 ? "" : "s"} couldn't be included; index.csv says which and why.`] : []),
    ...(gmailNote ? ["", gmailNote] : []),
    "",
  ].join("\r\n");
}
