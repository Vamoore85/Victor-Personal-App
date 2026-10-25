"use client";

import { useState } from "react";
import Link from "next/link";
import { useMoneyData } from "@/features/money/store";
import { Card, buttonClass, ghostButtonClass, inputClass } from "@/features/money/ui";
import { receiptZip, type ZipFile } from "@/lib/receipt-zip";
import { RECEIPT_SECTIONS, receiptCsv, receiptFolders, receiptYear, safeReceiptName, type FiledReceipt } from "./receipt-folders";
import type { EmailItem } from "./parse";

const encoder = new TextEncoder();

export function ReceiptFolders({ items }: { items: EmailItem[] }) {
  const data = useMoneyData();
  const rows = receiptFolders(items, data?.receipts ?? []);
  const filed = rows.filter(r => !r.reason);
  const years = [...new Set(filed.map(r => receiptYear(r.date)!))].sort().reverse();
  const [pickedYear, setPickedYear] = useState("");
  const year = years.includes(pickedYear) ? pickedYear : years[0] ?? String(new Date().getFullYear());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const pending = rows.filter(r => r.reason);

  async function download(selected: FiledReceipt[], company: string) {
    setBusy(company);
    setError(null);
    const folder = `${year}/${company}`;
    const files: ZipFile[] = [];
    let size = 0;
    try {
      // Fetch one at a time; originals are kept server-side and ZIP assembly stays on this device.
      for (let index = 0; index < selected.length; index++) {
        const r = selected[index];
        setProgress(`Preparing ${index + 1} of ${selected.length}`);
        const url = r.source === "email" ? `/api/gmail/receipts/${encodeURIComponent(r.id)}` : `/api/receipts/${encodeURIComponent(r.id)}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(`${r.merchant}: ${body.error || "Original file unavailable"}. No partial folder was downloaded.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        size += bytes.length;
        if (size > 128 * 1024 * 1024) throw new Error("This folder is over 128 MB. Download individual receipts below instead.");
        const ext = r.source === "email" ? "eml" : ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[r.contentType] ?? "bin");
        files.push({ name: `${folder}/${r.date}_${safeReceiptName(r.merchant)}_${r.source}-${safeReceiptName(r.id)}.${ext}`, bytes });
      }
      files.push({ name: `${folder}/Receipt index.csv`, bytes: encoder.encode(receiptCsv(selected)) });
      files.push({ name: `${folder}/Read me.txt`, bytes: encoder.encode("Original email receipts are .eml files, including any attachments. Open them in a mail app. Uploaded receipts keep their original file type. The CSV is an index, not an original receipt or proof of bank settlement. Company assignments and receipt dates come from your reviewed records. Missing dates/company assignments and unreviewed emails are kept in Needs review, outside this folder. Matching amounts alone do not establish duplicates. Gmail messages are not changed.\n") });
      const blob = new Blob([receiptZip(files)], { type: "application/zip" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `Receipts-${year}-${company}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setProgress("");
    }
  }

  return <Card title="Receipt folders">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Year → company. Download original receipts with an index.</p>
      <label className="flex items-center gap-2 text-sm">Year
        <select aria-label="Receipt folder year" className={inputClass} value={year} onChange={e => setPickedYear(e.target.value)}>
          {(years.length ? years : [year]).map(y => <option key={y}>{y}</option>)}
        </select>
      </label>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      {RECEIPT_SECTIONS.map(section => {
        const group = filed.filter(r => r.scope === section.scope && receiptYear(r.date) === year);
        const totals = new Map<string, number>();
        for (const r of group) if (r.amount !== null) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount);
        return <section key={section.scope} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h3 className="text-base font-semibold">{section.name}</h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{group.length} receipt{group.length === 1 ? "" : "s"} · {year}</p>
          <p className="my-2 text-lg font-semibold tabular-nums">{[...totals].map(([currency, value]) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value)).join(" + ") || "—"}</p>
          <button className={buttonClass} disabled={busy !== null || !group.length || !data} onClick={() => void download(group, section.name)}>{busy === section.name ? progress : "Download folder"}</button>
          {group.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer">View receipts</summary><ul className="mt-2 space-y-2">{group.map(r => <li key={`${r.source}:${r.id}`}><a className="underline" href={r.source === "email" ? `/api/gmail/receipts/${encodeURIComponent(r.id)}` : `/api/receipts/${encodeURIComponent(r.id)}`} target="_blank" rel="noreferrer">{r.date} · {r.merchant}</a></li>)}</ul></details>}
        </section>;
      })}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
    {pending.length > 0 && <details className="mt-4 rounded-lg border border-amber-300 p-3">
      <summary className="cursor-pointer font-medium">Needs review ({pending.length})</summary>
      <p className="mt-2 text-sm">Choose the company and actual receipt date in the review list below. These have not been filed under a company or year yet.</p>
      <ul className="my-2 max-h-56 space-y-2 overflow-auto text-sm">{pending.map(r => <li key={`${r.source}:${r.id}`}>{r.merchant} — {r.reason}</li>)}</ul>
      <Link href="/money" className={ghostButtonClass}>Uploaded receipts in Money</Link>
    </details>}
    {!filed.length && <p className="mt-3 text-sm text-zinc-500">Review receipts below to place them in their year and company folder. Unpaid bills stay outside Receipt folders.</p>}
  </Card>;
}
