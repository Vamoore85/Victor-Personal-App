"use client";

import { useRef, useState } from "react";
import { importMoneyData, useMoneyData } from "./store";
import { DEFAULT_CATEGORIES } from "./types";
import { categoriesInUse, today } from "./calc";
import { Accounts, Budgets, Overview, Transactions } from "./sections";
import { Bills } from "./bills";
import { ghostButtonClass } from "./ui";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "bills", label: "Bills" },
  { id: "budgets", label: "Budgets" },
];

export function FinancialCenter() {
  const data = useMoneyData();
  const [tab, setTab] = useState("overview");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!data) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  const categories = categoriesInUse(data, DEFAULT_CATEGORIES);

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maverick-money-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFile(file: File) {
    if (!confirm("Replace everything in the Financial Center with this backup?")) return;
    try {
      importMoneyData(await file.text());
    } catch {
      alert("That file isn't a valid Financial Center backup.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
                tab === t.id
                  ? "bg-white font-medium shadow-sm dark:bg-zinc-800"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button className={ghostButtonClass} onClick={exportData}>Export backup</button>
          <button className={ghostButtonClass} onClick={() => fileRef.current?.click()}>Import</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </nav>

      {tab === "overview" && <Overview data={data} goTo={setTab} />}
      {tab === "accounts" && <Accounts data={data} />}
      {tab === "transactions" && <Transactions data={data} categories={categories} />}
      {tab === "bills" && <Bills data={data} categories={categories} />}
      {tab === "budgets" && <Budgets data={data} categories={categories} />}
    </div>
  );
}
