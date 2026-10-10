"use client";

import { useRef, useState } from "react";
import { newId, setMoneyData } from "./store";
import { daysBetween } from "@/lib/dates";
import { money, today } from "./calc";
import { ScopeBadge, useDefaultScope } from "./scope";
import { COMPANIES, companyLabel, isCompany, type MoneyData, type Receipt, type Scope, type Transaction } from "./types";
import { businessCategory } from "./books";
import { Card, Empty, Field, Stat, buttonClass, ghostButtonClass, inputClass } from "./ui";

/*
 * Receipts: photos or PDFs saved to the online database and tied to the
 * transaction they back up. Photos are shrunk in the browser first so a
 * phone picture is a few hundred KB.
 */

const MAX_SIDE = 1800;
const RECEIPT_THRESHOLD = 75; // the IRS wants receipts for business expenses of $75 or more

const fileUrl = (r: Receipt) => `/api/receipts/${r.id}`;

async function shrink(file: File): Promise<Blob> {
  if (file.type === "application/pdf") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  return blob ?? file;
}

/** Uploads a file and returns the new receipt record (not yet saved to the money data). */
async function uploadReceipt(file: File, base: Partial<Receipt>): Promise<Receipt> {
  const blob = await shrink(file);
  const id = newId();
  const res = await fetch(`/api/receipts?id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || file.type },
    body: blob,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Couldn't save the receipt.");
  return {
    id,
    date: base.date ?? today(),
    merchant: base.merchant ?? "",
    amount: base.amount ?? null,
    note: "",
    transactionId: base.transactionId,
    scope: base.scope ?? "personal",
    contentType: blob.type || file.type,
    size: json.size ?? blob.size,
    addedAt: new Date().toISOString(),
  };
}

/** Expense transactions a receipt probably belongs to: same amount within a week, closest date first. */
function likelyMatches(data: MoneyData, r: Receipt) {
  if (r.amount === null) return [];
  const taken = new Set(data.receipts.filter((x) => x.transactionId && x.id !== r.id).map((x) => x.transactionId));
  return data.transactions
    .filter((t) => t.kind === "expense" && !t.transferId && !taken.has(t.id) && Math.abs(t.amount - (r.amount ?? 0)) < 0.01)
    .filter((t) => Math.abs(daysBetween(t.date, r.date)) <= 7)
    .sort((a, b) => Math.abs(daysBetween(a.date, r.date)) - Math.abs(daysBetween(b.date, r.date)))
    .slice(0, 3);
}

export function receiptFor(data: MoneyData, transactionId: string) {
  return data.receipts.find((r) => r.transactionId === transactionId);
}

/** Business expenses of $75 or more in the year with no receipt yet. */
function missingReceipts(data: MoneyData, year: number) {
  const scopes = new Map(data.accounts.map((a) => [a.id, a.scope ?? "personal"]));
  const backed = new Set(data.receipts.map((r) => r.transactionId).filter(Boolean));
  return data.transactions
    .filter((t) => t.kind === "expense" && !t.transferId && t.date.startsWith(String(year)))
    .filter((t) => isCompany(scopes.get(t.accountId)) && t.amount >= RECEIPT_THRESHOLD && !backed.has(t.id))
    .filter((t) => {
      const kind = businessCategory(t.category)?.kind;
      return kind !== "equity" && kind !== "transfer";
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function removeReceipt(r: Receipt) {
  if (!confirm("Delete this receipt?")) return;
  void fetch(fileUrl(r), { method: "DELETE" });
  setMoneyData((d) => ({ ...d, receipts: d.receipts.filter((x) => x.id !== r.id) }));
}

function updateReceipt(id: string, patch: Partial<Receipt>) {
  setMoneyData((d) => ({ ...d, receipts: d.receipts.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
}

function Thumb({ r }: { r: Receipt }) {
  return (
    <a href={fileUrl(r)} target="_blank" rel="noopener noreferrer" className="block h-20 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      {r.contentType === "application/pdf" ? (
        <span className="flex h-full items-center justify-center text-xs text-zinc-500">PDF</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- private, signed-in file served by our own route
        <img src={fileUrl(r)} alt={r.merchant || "Receipt"} className="h-full w-full object-cover" loading="lazy" />
      )}
    </a>
  );
}

/** A small "add receipt" button for one transaction. */
export function AttachReceipt({ t, scope, label = "Add receipt" }: { t: Transaction; scope: Scope; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadReceipt(file, { date: t.date, amount: t.amount, merchant: t.description, transactionId: t.id, scope });
      setMoneyData((d) => ({ ...d, receipts: [...d.receipts, r] }));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onPick(e.target.files)} />
      <button className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </>
  );
}

export function Receipts({ data }: { data: MoneyData }) {
  const defaultScope = useDefaultScope();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unmatched">("all");
  const year = Number(today().slice(0, 4));

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    setBusy(list.length);
    for (const file of list) {
      try {
        const r = await uploadReceipt(file, { scope: defaultScope });
        setMoneyData((d) => ({ ...d, receipts: [r, ...d.receipts] }));
      } catch (e) {
        setError((e as Error).message);
      }
      setBusy((n) => n - 1);
    }
    if (input.current) input.current.value = "";
  }

  const receipts = [...data.receipts]
    .filter((r) => filter === "all" || !r.transactionId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.addedAt.localeCompare(a.addedAt));
  const unmatched = data.receipts.filter((r) => !r.transactionId).length;
  const missing = missingReceipts(data, year);
  const txns = new Map(data.transactions.map((t) => [t.id, t]));
  const accountScope = new Map(data.accounts.map((a) => [a.id, (a.scope ?? "personal") as Scope]));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Receipts saved" value={String(data.receipts.length)} />
        <Stat label="Not matched yet" value={String(unmatched)} tone={unmatched > 0 ? "bad" : undefined} />
        <Stat label={`Business costs missing a receipt (${year})`} value={String(missing.length)} tone={missing.length > 0 ? "bad" : "good"} />
      </div>

      <Card title="Add receipts">
        <p className="mb-4 text-sm text-zinc-500">
          On your phone, this opens the camera or your photos. Snap the receipt, then type the amount below and pick the matching purchase.
        </p>
        <input ref={input} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
        <button className={buttonClass} onClick={() => input.current?.click()} disabled={busy > 0}>
          {busy > 0 ? `Saving ${busy}…` : "Add receipt photos"}
        </button>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Card>

      <Card
        title="Your receipts"
        action={
          <select className="rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" value={filter} onChange={(e) => setFilter(e.target.value as "all" | "unmatched")}>
            <option value="all">All</option>
            <option value="unmatched">Not matched yet</option>
          </select>
        }
      >
        {receipts.length === 0 ? (
          <Empty>{filter === "all" ? "No receipts yet." : "Every receipt is matched to a purchase."}</Empty>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {receipts.map((r) => (
              <ReceiptRow key={r.id} r={r} data={data} matched={r.transactionId ? txns.get(r.transactionId) : undefined} />
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Business costs of $${RECEIPT_THRESHOLD} or more without a receipt (${year})`}>
        {missing.length === 0 ? (
          <Empty>Nothing missing. Every business cost of ${RECEIPT_THRESHOLD} or more this year has a receipt.</Empty>
        ) : (
          <>
            <p className="mb-3 text-xs text-zinc-500">
              The IRS expects a receipt for business costs of ${RECEIPT_THRESHOLD} or more, and for all travel, meals and gifts.
            </p>
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {missing.slice(0, 50).map((t) => {
                const scope = accountScope.get(t.accountId) ?? "business";
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.description}</p>
                      <p className="text-xs text-zinc-500">
                        {t.date} · {t.category} · {companyLabel(scope)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm tabular-nums">{money(t.amount)}</span>
                      <AttachReceipt t={t} scope={scope} />
                    </div>
                  </li>
                );
              })}
            </ul>
            {missing.length > 50 && <p className="mt-2 text-xs text-zinc-500">Showing the 50 most recent of {missing.length}.</p>}
          </>
        )}
      </Card>
    </div>
  );
}

function ReceiptRow({ r, data, matched }: { r: Receipt; data: MoneyData; matched?: Transaction }) {
  const [amount, setAmount] = useState(r.amount === null ? "" : String(r.amount));
  const [merchant, setMerchant] = useState(r.merchant);
  const suggestions = matched ? [] : likelyMatches(data, r);
  const scopes: Scope[] = ["personal", ...COMPANIES.map((c) => c.value)];

  return (
    <li className="flex gap-4 py-3">
      <Thumb r={r} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Store">
            <input
              className={inputClass}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              onBlur={() => merchant.trim() !== r.merchant && updateReceipt(r.id, { merchant: merchant.trim() })}
              placeholder="Home Depot"
            />
          </Field>
          <Field label="Amount">
            <input
              className={inputClass}
              inputMode="decimal"
              value={amount}
              placeholder="0.00"
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => {
                const n = Number(amount.replace(/[$,\s]/g, ""));
                updateReceipt(r.id, { amount: amount.trim() && Number.isFinite(n) ? Math.round(n * 100) / 100 : null });
              }}
            />
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={r.date} onChange={(e) => e.target.value && updateReceipt(r.id, { date: e.target.value })} />
          </Field>
          <Field label="Whose is it">
            <select className={inputClass} value={r.scope ?? "personal"} onChange={(e) => updateReceipt(r.id, { scope: e.target.value as Scope })}>
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {s === "personal" ? "Personal" : companyLabel(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {matched ? (
            <>
              <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                ✓ Matched: {matched.description} · {matched.date} · {money(matched.amount)}
              </span>
              <button className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => updateReceipt(r.id, { transactionId: undefined })}>
                Unmatch
              </button>
            </>
          ) : suggestions.length > 0 ? (
            <>
              <span className="text-zinc-500">Looks like:</span>
              {suggestions.map((t) => (
                <button key={t.id} className={ghostButtonClass} onClick={() => {
                    const name = r.merchant || t.description;
                    setMerchant(name);
                    updateReceipt(r.id, { transactionId: t.id, merchant: name, date: t.date });
                  }}>
                  {t.description} · {t.date}
                </button>
              ))}
            </>
          ) : (
            <span className="text-zinc-400">{r.amount === null ? "Type the amount to find the matching purchase." : "No purchase with this amount within a week yet."}</span>
          )}
          <span className="ml-auto flex items-center gap-3">
            <ScopeBadge item={r} />
            <button className="text-zinc-400 hover:text-rose-600" onClick={() => removeReceipt(r)}>
              Delete
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}
