"use client";

import { useRef, useState } from "react";
import { ScopeContext, filterByScope, type ScopeView } from "./scope";
import { cloudErrorMessage, importMoneyData, retryCloud, useCloudState, useMoneyData } from "./store";
import { exportEncryptedVault, importEncryptedVault } from "./vault";
import { DEFAULT_CATEGORIES } from "./types";
import { categoriesInUse, today } from "./calc";
import { Accounts, Budgets, Overview, Transactions } from "./sections";
import { Bills } from "./bills";
import { Institutions } from "./institutions";
import { VaultAutoLock } from "./vault-ui";
import { BankLinks, useAutoSync } from "./plaid";
import { ghostButtonClass } from "./ui";
import { Books } from "./books-ui";
import { BUSINESS_CATEGORY_NAMES } from "./books";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "bills", label: "Bills" },
  { id: "budgets", label: "Budgets" },
  { id: "books", label: "Maverick books" },
  { id: "institutions", label: "Maverick Vault" },
];

export function FinancialCenter() {
  const data = useMoneyData();
  const cloud = useCloudState();
  const [tab, setTab] = useState("overview");
  const [view, setView] = useState<ScopeView>(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("maverick.money.view") : null;
      return saved === "personal" || saved === "business" ? saved : "all";
    } catch {
      return "all";
    }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  useAutoSync(data);

  if (!data) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  const personalCategories = categoriesInUse(filterByScope(data, "personal"), DEFAULT_CATEGORIES);
  const categories =
    view === "business"
      ? BUSINESS_CATEGORY_NAMES
      : view === "personal"
        ? personalCategories
        : [...new Set([...personalCategories, ...BUSINESS_CATEGORY_NAMES])];
  const shown = filterByScope(data, view);

  function chooseView(v: ScopeView) {
    setView(v);
    try {
      window.localStorage.setItem("maverick.money.view", v);
    } catch {
      // Not remembered; fine.
    }
  }

  function exportData() {
    // The vault goes into the backup still encrypted; it needs the master password to open.
    const backup = { ...data, vault: exportEncryptedVault() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
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
      const text = await file.text();
      importMoneyData(text);
      const vault = (JSON.parse(text) as { vault?: unknown }).vault;
      if (vault) importEncryptedVault(vault);
    } catch {
      alert("That file isn't a valid Financial Center backup.");
    }
  }

  return (
    <ScopeContext.Provider value={view}>
    <div className="flex flex-col gap-6">
      <VaultAutoLock />
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-full border border-zinc-300 p-0.5 dark:border-zinc-700">
          {([
            ["all", "All"],
            ["personal", "Personal"],
            ["business", "Maverick"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              onClick={() => chooseView(v)}
              className={`rounded-full px-4 py-1.5 text-sm ${
                view === v ? "bg-brand font-medium text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          {view === "all" ? "Showing personal and Maverick together" : `Showing ${view === "business" ? "Maverick" : "personal"} only`}
        </span>
        <CloudBadge state={cloud} />
      </div>
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
                tab === t.id
                  ? "bg-white font-medium text-brand shadow-sm dark:bg-zinc-800"
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

      {tab === "overview" && <Overview data={shown} goTo={setTab} />}
      {tab === "accounts" && (
        <>
          <BankLinks data={shown} />
          <Accounts data={shown} />
        </>
      )}
      {tab === "transactions" && <Transactions data={shown} categories={categories} />}
      {tab === "bills" && <Bills data={shown} categories={categories} />}
      {tab === "budgets" && <Budgets data={shown} categories={categories} />}
      {tab === "institutions" && <Institutions data={shown} />}
      {tab === "books" && <Books data={data} goTo={setTab} />}
    </div>
    </ScopeContext.Provider>
  );
}

function CloudBadge({ state }: { state: ReturnType<typeof useCloudState> }) {
  if (state === "off") return <span className="ml-auto text-xs text-zinc-400">Saved on this device only</span>;
  if (state === "error")
    return (
      <span className="ml-auto max-w-md text-right text-xs text-rose-600 dark:text-rose-400">
        <button className="underline" onClick={retryCloud}>
          Couldn&apos;t save online. Try again
        </button>
        {cloudErrorMessage() && <span className="mt-1 block">{cloudErrorMessage()}</span>}
      </span>
    );
  const label = state === "saving" ? "Saving…" : state === "loading" ? "Loading…" : "Saved online";
  return <span className="ml-auto text-xs text-zinc-500">{label}</span>;
}
