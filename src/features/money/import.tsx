"use client";

import { useState } from "react";
import { newId, setMoneyData } from "./store";
import type { MoneyData, Scope, Transaction } from "./types";
import { BUSINESS_CATEGORY_NAMES, businessGuess, ruleCategory } from "./books";
import { money } from "./calc";
import { Card, Field, buttonClass, ghostButtonClass, inputClass } from "./ui";

/* Statement import: reads the CSV download every bank and card site offers. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

/** Accepts 2026-10-07, 10/07/2026, 10/7/26 and 10-07-2026. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

/** "$1,234.56", "(12.00)" and "-12.00" all parse; blank is null. */
export function parseMoney(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t) || t.includes("-");
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || t.replace(/[^\d]/g, "") === "") return null;
  return negative ? -n : n;
}

type Mapping = {
  date: number;
  description: number;
  amount: number; // -1 when the statement uses separate debit/credit columns
  debit: number;
  credit: number;
  category: number;
};

const find = (headers: string[], words: string[]) => {
  const lower = headers.map((h) => h.toLowerCase());
  for (const w of words) {
    const i = lower.findIndex((h) => h === w);
    if (i >= 0) return i;
  }
  for (const w of words) {
    const i = lower.findIndex((h) => h.includes(w));
    if (i >= 0) return i;
  }
  return -1;
};

export function guessMapping(headers: string[]): Mapping {
  return {
    date: find(headers, ["transaction date", "date", "posted date", "posting date", "trans. date"]),
    description: find(headers, ["description", "payee", "merchant", "name", "details", "memo"]),
    amount: find(headers, ["amount", "transaction amount"]),
    debit: find(headers, ["debit", "withdrawal", "withdrawals", "charge"]),
    credit: find(headers, ["credit", "deposit", "deposits", "payment"]),
    category: find(headers, ["category"]),
  };
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/payroll|direct dep|salary/i, "Salary"],
  [/rent|mortgage|apartment/i, "Housing"],
  [/electric|energy|water|gas co|utility|comcast|xfinity|verizon|at&t|t-mobile|spectrum/i, "Utilities"],
  [/grocery|safeway|giant|kroger|whole foods|trader joe|aldi|wegmans|costco|food lion|harris teeter/i, "Groceries"],
  [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|doordash|uber eats|grubhub|pizza|dunkin/i, "Dining"],
  [/shell|exxon|bp |sunoco|chevron|uber|lyft|parking|toll|mva|metro/i, "Transportation"],
  [/insurance|geico|state farm|progressive|allstate/i, "Insurance"],
  [/pharmacy|cvs|walgreens|doctor|medical|dental|hospital/i, "Health"],
  [/netflix|spotify|hulu|disney|apple\.com|google|amazon prime|youtube/i, "Subscriptions"],
  [/amazon|target|walmart|best buy|home depot|lowe/i, "Shopping"],
];

function guessCategory(description: string, fromFile: string) {
  if (fromFile) return fromFile;
  return CATEGORY_RULES.find(([re]) => re.test(description))?.[1] ?? "Other";
}

type Row = Omit<Transaction, "id" | "accountId">;

const TRANSFER_RE = /payment.*thank you|autopay|auto pay|online payment|card payment|pymt|transfer (to|from)|online transfer|zelle to self/i;

function buildRows(
  rows: string[][],
  map: Mapping,
  positiveIsSpending: boolean,
  data: MoneyData,
  scope: Scope,
): { rows: Row[]; skipped: number } {
  const out: Row[] = [];
  let skipped = 0;
  for (const r of rows) {
    const date = map.date >= 0 ? parseDate(r[map.date] ?? "") : null;
    let signed: number | null = null;
    if (map.amount >= 0) {
      const v = parseMoney(r[map.amount] ?? "");
      if (v !== null) signed = positiveIsSpending ? -v : v;
    } else {
      const out_ = map.debit >= 0 ? parseMoney(r[map.debit] ?? "") : null;
      const in_ = map.credit >= 0 ? parseMoney(r[map.credit] ?? "") : null;
      if (out_) signed = -Math.abs(out_);
      else if (in_) signed = Math.abs(in_);
    }
    if (!date || signed === null || signed === 0) {
      skipped++;
      continue;
    }
    const description = (map.description >= 0 ? r[map.description] : "") || "Imported";
    // Card payments and moves between your own accounts aren't income or spending.
    if (TRANSFER_RE.test(description)) {
      out.push({ date, description, amount: Math.abs(signed), kind: signed > 0 ? "income" : "expense", category: "Transfer", transferId: "imported" });
      continue;
    }
    const income = signed > 0;
    const fromFile = map.category >= 0 ? r[map.category] ?? "" : "";
    // A category you picked before for the same description wins; then a guess.
    const learned = ruleCategory(data.rules, description, scope);
    let category: string;
    if (learned) category = learned;
    else if (scope === "business") category = BUSINESS_CATEGORY_NAMES.includes(fromFile) ? fromFile : businessGuess(description, income);
    else category = income && !fromFile ? "Other income" : guessCategory(description, fromFile);
    out.push({ date, description, amount: Math.abs(signed), kind: income ? "income" : "expense", category });
  }
  return { rows: out, skipped };
}

/** `scope` limits the account list, e.g. to Maverick's accounts on the books tab. */
export function StatementImport({ data, scope }: { data: MoneyData; scope?: Scope }) {
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [accountId, setAccountId] = useState("");
  const [positiveIsSpending, setPositiveIsSpending] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  const accounts = scope ? data.accounts.filter((a) => (a.scope ?? "personal") === scope) : data.accounts;
  const account = accounts.find((a) => a.id === (accountId || accounts[0]?.id));
  const accountScope: Scope = account?.scope ?? "personal";

  async function load(f: File) {
    setMessage("");
    const all = parseCsv(await f.text());
    // Some banks put a few summary lines above the real header row.
    const headerAt = all.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
    if (headerAt < 0) {
      setMessage("Couldn't find a header row with a date column. Download the CSV version of the statement and try again.");
      return;
    }
    const headers = all[headerAt];
    setFile({ name: f.name, headers, rows: all.slice(headerAt + 1) });
    setMap(guessMapping(headers));
    setPositiveIsSpending(null);
  }

  if (accounts.length === 0) return null;

  // Card statements usually list charges as positive numbers; bank statements as negative.
  const guessPositiveIsSpending = (() => {
    if (!file || !map || map.amount < 0) return false;
    const vals = file.rows.map((r) => parseMoney(r[map.amount] ?? "")).filter((v): v is number => v !== null);
    const positives = vals.filter((v) => v > 0).length;
    return account?.type === "credit" && positives > vals.length / 2;
  })();
  const flip = positiveIsSpending ?? guessPositiveIsSpending;
  const built = file && map ? buildRows(file.rows, map, flip, data, accountScope) : null;

  const existing = new Set(
    data.transactions
      .filter((t) => t.accountId === account?.id)
      .map((t) => `${t.date}|${t.amount.toFixed(2)}|${t.kind}|${t.description.toLowerCase()}`),
  );
  const fresh = built?.rows.filter((r) => !existing.has(`${r.date}|${r.amount.toFixed(2)}|${r.kind}|${r.description.toLowerCase()}`)) ?? [];
  const dupes = (built?.rows.length ?? 0) - fresh.length;

  function commit() {
    if (!account || fresh.length === 0) return;
    setMoneyData((d) => ({
      ...d,
      transactions: [...d.transactions, ...fresh.map((r) => ({ ...r, id: newId(), accountId: account.id }))],
    }));
    setMessage(`Imported ${fresh.length} transactions into ${account.name}.`);
    setFile(null);
    setMap(null);
  }

  const columnSelect = (label: string, key: keyof Mapping, optional = true) =>
    map &&
    file && (
      <Field label={label}>
        <select className={inputClass} value={map[key]} onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}>
          {optional && <option value={-1}>None</option>}
          {file.headers.map((h, i) => (
            <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
          ))}
        </select>
      </Field>
    );

  return (
    <Card title="Import a statement">
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <Field label="Into account">
          <select className={inputClass} value={account?.id ?? ""} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Statement file (.csv)">
          <input
            className={inputClass}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
              e.target.value = "";
            }}
          />
        </Field>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        On your bank or card website, open the account&apos;s activity and choose Download or Export as CSV. Rows already
        imported are skipped, so overlapping statements are fine.
      </p>

      {file && map && built && (
        <div className="mt-5 flex flex-col gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-sm">
            <span className="font-medium">{file.name}</span>: check the columns, then import.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {columnSelect("Date", "date", false)}
            {columnSelect("Description", "description")}
            {columnSelect("Amount", "amount")}
            {map.amount < 0 && columnSelect("Money out column", "debit")}
            {map.amount < 0 && columnSelect("Money in column", "credit")}
            {columnSelect("Category (if the file has one)", "category")}
          </div>
          {map.amount >= 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={flip} onChange={(e) => setPositiveIsSpending(e.target.checked)} />
              Positive amounts are charges (common on credit card statements)
            </label>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-1 pr-3 font-normal">Date</th>
                  <th className="py-1 pr-3 font-normal">Description</th>
                  <th className="py-1 pr-3 font-normal">Category</th>
                  <th className="py-1 text-right font-normal">Amount</th>
                </tr>
              </thead>
              <tbody>
                {built.rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-500">{r.date}</td>
                    <td className="max-w-64 truncate py-1.5 pr-3">{r.description}</td>
                    <td className="py-1.5 pr-3 text-zinc-500">{r.category}</td>
                    <td className={`py-1.5 text-right tabular-nums ${r.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                      {r.kind === "income" ? "+" : "−"}
                      {money(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            {built.rows.length} transactions found
            {built.rows.length > 8 && ", first 8 shown"}
            {dupes > 0 && ` · ${dupes} already in the app will be skipped`}
            {built.skipped > 0 && ` · ${built.skipped} rows without a date or amount ignored`}
          </p>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={commit} disabled={fresh.length === 0}>
              Import {fresh.length} into {account?.name}
            </button>
            <button className={ghostButtonClass} onClick={() => { setFile(null); setMap(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-sm">{message}</p>}
    </Card>
  );
}
