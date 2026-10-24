"use client";

import { useState } from "react";
import { loadFile } from "@/lib/files";
import { bucketLabel, bucketOf } from "./bill-intel";
import { BUSINESS_CATEGORY_NAMES } from "./books";
import { BucketChip } from "./bucket-ui";
import { money, shortDate } from "./calc";
import { checkRows, csvRows, findOtherFiles, formatOf, ofxRows, type Checked, type FoundFile } from "./docs";
import { buildRows, type Row } from "./import";
import { newId, setMoneyData } from "./store";
import { readStatementPdf } from "./statement-pdf";
import { DEFAULT_CATEGORIES, type DocImport, type MoneyData } from "./types";
import { Card, Empty, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";
import { Tag } from "./intel-shared";

/*
 * The Documents tab: statements and exports you upload, what was read from
 * each, and what was imported. The bank feed (Plaid) is the main source;
 * documents fill in history it doesn't have. Files are read in this browser
 * and aren't kept or sent anywhere; only the rows you import are saved.
 */

type Draft = { name: string; size: number; format: DocImport["format"]; text?: string; file?: File; origin?: string };
type Review = Draft & { rows: Row[]; skipped: number; note: string; ok: boolean; accountId: string; checked: Checked[]; last4?: string };

const STATUS: Record<DocImport["status"], { label: string; tone?: "good" | "warn" | "bad" }> = {
  imported: { label: "Imported", tone: "good" },
  "needs-review": { label: "Needs review", tone: "warn" },
  unreadable: { label: "Can't read", tone: "bad" },
};

export function Documents({ data, goTo }: { data: MoneyData; goTo: (tab: string) => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [others, setOthers] = useState<FoundFile[] | null>(null);

  const record = (doc: Omit<DocImport, "id" | "addedAt">) =>
    setMoneyData((d) => ({ ...d, docImports: [{ ...doc, id: newId(), addedAt: new Date().toISOString() }, ...d.docImports] }));

  async function read(draft: Draft, accountId = review?.accountId || data.accounts[0]?.id || "") {
    setMessage("");
    setBusy(true);
    try {
      const acct = data.accounts.find((a) => a.id === accountId);
      const scope = acct?.scope ?? "personal";
      let rows: Row[] = [];
      let skipped = 0;
      let note = "";
      let ok = true;
      let last4: string | undefined;
      if (draft.format === "csv") {
        const r = csvRows(draft.text ?? (await draft.file!.text()), data, scope, acct?.type === "credit");
        ({ rows, skipped, ok } = r);
        note = ok ? `${rows.length} rows read${skipped ? `, ${skipped} lines without a date and amount skipped` : ""}.` : "Couldn't find date and amount columns in this CSV.";
      } else if (draft.format === "ofx") {
        const r = ofxRows(draft.text ?? (await draft.file!.text()), data, scope);
        ({ rows, skipped, last4 } = r);
        ok = rows.length > 0;
        note = ok ? `${rows.length} transactions read from the OFX/QFX file.` : "No transactions found in this file.";
      } else if (draft.format === "pdf") {
        const st = await readStatementPdf(draft.file!);
        if (st.txns.length && st.balanced) {
          const table = st.txns.map((t) => [t.date, t.description, (t.kind === "income" ? t.amount : -t.amount).toFixed(2)]);
          ({ rows, skipped } = buildRows(table, { date: 0, description: 1, amount: 2, debit: -1, credit: -1, category: -1 }, false, data, scope));
          note = `Statement ${st.period || ""} read; it adds up to the statement's own balances.`;
        } else {
          ok = false;
          note = st.txns.length
            ? "Read some lines, but they don't add up to the statement's balances, so nothing was imported. Download a CSV or OFX/QFX from the bank instead."
            : "This PDF isn't a statement layout Maverick can read exactly. Download a CSV or OFX/QFX from the bank instead.";
        }
      } else {
        ok = false;
        note = draft.format === "image" ? "Photos and scans aren't read automatically. Add it as a receipt, or download a CSV or OFX/QFX from the bank." : "Only CSV, OFX/QFX and statement PDFs can be imported.";
      }
      if (!ok) {
        record({ name: draft.name, format: draft.format, size: draft.size, status: draft.format === "image" || draft.format === "other" ? "needs-review" : "unreadable", note, rows: rows.length, imported: 0, duplicates: 0, maybe: 0, origin: draft.origin });
        setReview(null);
        setMessage(`${draft.name}: ${note}`);
        return;
      }
      // An OFX file names its account: pick the matching one when there is one.
      const byMask = last4 ? data.accounts.find((a) => a.last4 === last4) : undefined;
      const target = byMask?.id ?? accountId;
      setReview({ ...draft, rows, skipped, note, ok, accountId: target, checked: checkRows(data, target, rows), last4 });
    } catch {
      setMessage(`Couldn't read ${draft.name}.`);
    } finally {
      setBusy(false);
    }
  }

  function chooseFiles(files: FileList | null) {
    const f = files?.[0];
    if (f) void read({ name: f.name, size: f.size, format: formatOf(f.name, f.type), file: f });
  }

  async function addFromApp(x: FoundFile) {
    const blob = await loadFile(x.id).catch(() => undefined);
    if (!blob) {
      setMessage(`${x.name} isn't stored in this browser (it was added on another device).`);
      return;
    }
    const file = new File([blob], x.name, { type: x.type });
    void read({ name: x.name, size: x.size, format: formatOf(x.name, x.type), file, origin: `${x.area}: ${x.title}` });
  }

  function commit() {
    if (!review) return;
    const acct = data.accounts.find((a) => a.id === review.accountId);
    if (!acct) return;
    const docId = newId();
    const take = review.checked.filter((r) => r.include);
    const dates = review.rows.map((r) => r.date).sort();
    setMoneyData((d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        ...take.map((r) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          kind: r.kind,
          category: r.category,
          categoryLocked: r.categoryLocked,
          transferId: r.transferId ? `doc-${docId}` : undefined,
          id: newId(),
          accountId: acct.id,
          docId,
        })),
      ],
      docImports: [
        {
          id: docId,
          name: review.name,
          format: review.format,
          size: review.size,
          addedAt: new Date().toISOString(),
          status: "imported",
          note: review.note,
          accountId: acct.id,
          first: dates[0],
          last: dates[dates.length - 1],
          rows: review.rows.length,
          imported: take.length,
          duplicates: review.checked.filter((r) => r.status === "duplicate" && !r.include).length,
          maybe: review.checked.filter((r) => r.status === "maybe" && !r.include).length,
          origin: review.origin,
        },
        ...d.docImports,
      ],
    }));
    setMessage(`Imported ${take.length} transactions from ${review.name} into ${acct.name}.`);
    setReview(null);
  }

  function undo(doc: DocImport) {
    const n = data.transactions.filter((t) => t.docId === doc.id).length;
    if (!confirm(`Remove the ${n} transactions imported from ${doc.name}? Bank-feed transactions aren't touched.`)) return;
    setMoneyData((d) => ({
      ...d,
      transactions: d.transactions.filter((t) => t.docId !== doc.id),
      docImports: d.docImports.map((x) => (x.id === doc.id ? { ...x, status: "needs-review", imported: 0, note: "Import removed by you." } : x)),
    }));
  }

  const matched = data.receipts.filter((r) => r.transactionId).length;

  return (
    <div className="flex flex-col gap-3 lg:gap-4">
      <Card title="Add a statement or export">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          The bank feed is the main source. Use documents for history it doesn&apos;t have. CSV and OFX/QFX downloads are read exactly; statement PDFs only when they
          add up to their own balances. Files are read on this device and not kept; rows already in the bank feed are skipped.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${buttonClass} cursor-pointer`}>
            {busy ? "Reading…" : "Choose a file"}
            <input type="file" accept=".csv,.ofx,.qfx,.qbo,.pdf,image/*" className="hidden" onChange={(e) => (chooseFiles(e.target.files), (e.target.value = ""))} />
          </label>
          <button className={ghostButtonClass} onClick={() => setOthers(findOtherFiles())}>
            Look for statements elsewhere in the app
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>}
        {others && (
          <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
            <p className="mb-1 text-xs text-zinc-500">
              Files attached in Invest, Research, Events and Travel live only in this browser. Nothing is added until you choose it.
            </p>
            {others.length === 0 ? (
              <Empty>No CSV, OFX/QFX or PDF attachments found there on this device.</Empty>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {others.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {x.name} <span className="text-xs text-zinc-500">· {x.area}: {x.title}</span>
                    </span>
                    <button className="text-xs font-medium text-brand underline" onClick={() => void addFromApp(x)}>
                      Add to Financial documents
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      {review && <ReviewCard review={review} data={data} onChange={setReview} onAccount={(id) => void read(review, id)} onCommit={commit} onCancel={() => setReview(null)} />}

      <Card title="Documents">
        {data.docImports.length === 0 ? (
          <Empty>No statements or exports added yet.</Empty>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.docImports.map((doc) => {
              const acct = data.accounts.find((a) => a.id === doc.accountId);
              return (
                <li key={doc.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{doc.name}</span>
                    <Tag tone={STATUS[doc.status].tone}>{STATUS[doc.status].label}</Tag>
                    {acct && <BucketChip scope={acct.scope} />}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {doc.format.toUpperCase()} · added {shortDate(doc.addedAt.slice(0, 10))}
                    {doc.first && ` · covers ${doc.first} to ${doc.last}`}
                    {acct && ` · ${acct.name}`}
                    {doc.status === "imported" && ` · ${doc.imported} imported, ${doc.duplicates} already here, ${doc.maybe} possible duplicates left out`}
                    {doc.origin && ` · from ${doc.origin}`}
                  </p>
                  {doc.note && <p className="text-xs text-zinc-500">{doc.note}</p>}
                  {doc.status === "imported" && doc.imported > 0 && (
                    <button className="self-start text-xs text-zinc-500 underline hover:text-rose-600" onClick={() => undo(doc)}>
                      Remove what was imported
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card title="Other financial files already here">
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              Receipts: {data.receipts.length} ({matched} matched to a transaction). Stored privately on your site&apos;s server. They back up spending; they aren&apos;t
              counted again.
            </span>
            <button className="text-xs underline" onClick={() => goTo("receipts")}>Open Receipts</button>
          </li>
          <li className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              Tax documents: {data.taxDocs.length}. Stored privately on your site&apos;s server and kept for taxes; not read into spending.
            </span>
            <button className="text-xs underline" onClick={() => goTo("taxes")}>Open Taxes</button>
          </li>
          <li className="text-zinc-500">
            Statements imported before this list existed came in through Company books; their rows are in Transactions marked &quot;statement or typed in&quot;.
          </li>
        </ul>
      </Card>
      <p className="text-xs text-zinc-500">Imported rows are marked as coming from a document. When the bank feed later brings the same transaction, the bank&apos;s copy replaces it.</p>
    </div>
  );
}

function ReviewCard({
  review,
  data,
  onChange,
  onAccount,
  onCommit,
  onCancel,
}: {
  review: Review;
  data: MoneyData;
  onChange: (r: Review) => void;
  onAccount: (id: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const acct = data.accounts.find((a) => a.id === review.accountId);
  const company = acct?.scope === "business" || acct?.scope === "gladiator";
  const categories = company ? BUSINESS_CATEGORY_NAMES : DEFAULT_CATEGORIES;
  const counts = { new: 0, duplicate: 0, maybe: 0 };
  for (const r of review.checked) counts[r.status]++;
  const take = review.checked.filter((r) => r.include);
  const out = take.filter((r) => r.kind === "expense").reduce((s, r) => s + r.amount, 0);
  const set = (key: string, patch: Partial<Checked>) => onChange({ ...review, checked: review.checked.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const groups = (["pm", "gladiator"] as const).map((b) => ({ b, accounts: data.accounts.filter((a) => bucketOf(a.scope) === b) }));

  return (
    <Card title={`Review: ${review.name}`}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{review.note}</p>
        <Field label="Import into (this decides the owner)">
          <select className={inputClass} value={review.accountId} onChange={(e) => onAccount(e.target.value)}>
            {groups.map(({ b, accounts }) => (
              <optgroup key={b} label={bucketLabel(b)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.last4 ? ` ··${a.last4}` : ""}
                    {a.plaid ? " (bank feed)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {data.accounts.length === 0 && <Empty>Add the account first on Accounts, then import into it.</Empty>}
        {review.last4 && acct?.last4 !== review.last4 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">The file is for an account ending {review.last4}; the chosen account ends {acct?.last4 ?? "with no number"}. Check it&apos;s the right one.</p>
        )}
        <p className="text-sm">
          {counts.new} new · {counts.duplicate} already here (skipped) · {counts.maybe} possible duplicates (left out unless you tick them)
        </p>
        <ul className="max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto text-sm dark:divide-zinc-800">
          {review.checked.map((r) => (
            <li key={r.key} className={`flex flex-col gap-1 py-1.5 ${r.include ? "" : "opacity-60"}`}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={r.include} onChange={(e) => set(r.key, { include: e.target.checked })} aria-label={`Import ${r.description} on ${r.date}`} />
                <span className="w-20 shrink-0 tabular-nums text-zinc-500">{shortDate(r.date)}</span>
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className={`shrink-0 tabular-nums ${r.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                  {r.kind === "income" ? "+" : ""}
                  {money(r.amount)}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-zinc-500">
                {r.status !== "new" && <Tag tone={r.status === "maybe" ? "warn" : undefined}>{r.status === "maybe" ? "Possible duplicate" : "Already here"}</Tag>}
                {r.why && <span className="min-w-0 truncate">{r.why}</span>}
                {r.include && !r.transferId && (
                  <select className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700" value={r.category} onChange={(e) => set(r.key, { category: e.target.value, categoryLocked: true })} aria-label="Category">
                    {[...new Set([r.category, ...categories])].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
                {r.transferId && <span>Move between accounts (not spending)</span>}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button className={buttonClass} onClick={onCommit} disabled={!acct || take.length === 0}>
            Import {take.length} into {acct?.name ?? "…"}
          </button>
          <button className={ghostButtonClass} onClick={onCancel}>
            Cancel
          </button>
          <span className="text-xs text-zinc-500">{money(out)} going out in what you&apos;re importing</span>
        </div>
      </div>
    </Card>
  );
}
