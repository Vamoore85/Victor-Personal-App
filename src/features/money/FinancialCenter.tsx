"use client";

import { useEffect, useRef, useState } from "react";
import { ScopeContext, filterByScope, type ScopeView } from "./scope";
import { cloudErrorMessage, importMoneyData, retryCloud, useCloudState, useMoneyData } from "./store";
import { exportEncryptedVault, importEncryptedVault } from "./vault";
import { DEFAULT_CATEGORIES } from "./types";
import { categoriesInUse, today } from "./calc";
import { Accounts, Budgets, Overview, Transactions } from "./sections";
import { Bills } from "./bill-intel-ui";
import { Spending } from "./spending-ui";
import { Documents } from "./documents-ui";
import { Institutions } from "./institutions";
import { VaultAutoLock } from "./vault-ui";
import { BankLinks, useAutoSync } from "./plaid";
import { ghostButtonClass } from "./ui";
import { Books } from "./books-ui";
import { BUSINESS_CATEGORY_NAMES } from "./books";
import { CommandCenter } from "./command-center";
import { Receipts } from "./receipts";
import { Taxes } from "./taxes";
import { clearQuickBooksNotice, quickBooksNotice as readQuickBooksNotice } from "./quickbooks";
import { COMPANIES, isCompany, type Company } from "./types";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "bills", label: "Bills" },
  { id: "spending", label: "Spending" },
  { id: "budgets", label: "Budgets" },
  { id: "books", label: "Company books" },
  { id: "receipts", label: "Receipts" },
  { id: "documents", label: "Documents" },
  { id: "taxes", label: "Taxes" },
  { id: "institutions", label: "Maverick Vault" },
];

const OWN_ENTITY = new Set(["bills", "spending"]);
const entityFor = (v: ScopeView) => (v === "gladiator" ? ("gladiator" as const) : v === "all" ? undefined : ("pm" as const));

export function FinancialCenter() {
  const data = useMoneyData();
  const cloud = useCloudState();
  const [tab, setTab] = useState(() => (readQuickBooksNotice() ? "books" : "overview"));
  const [view, setView] = useState<ScopeView>(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("maverick.money.view") : null;
      return saved === "personal" || saved === "business" || saved === "gladiator" ? saved : "all";
    } catch {
      return "all";
    }
  });
  const [booksCompany, setBooksCompany] = useState<Company | null>(() => (readQuickBooksNotice() ? "gladiator" : null));
  // Coming back from QuickBooks sign-in opens Gladiator's books with the result.
  const [quickBooksNotice] = useState(readQuickBooksNotice);
  const fileRef = useRef<HTMLInputElement>(null);
  useAutoSync(data);

  useEffect(clearQuickBooksNotice, []);

  if (!data) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  const personalCategories = categoriesInUse(filterByScope(data, "personal"), DEFAULT_CATEGORIES);
  const categories =
    isCompany(view === "all" ? undefined : view)
      ? BUSINESS_CATEGORY_NAMES
      : view === "personal"
        ? personalCategories
        : [...new Set([...personalCategories, ...BUSINESS_CATEGORY_NAMES])];
  const shown = filterByScope(data, view);

  function chooseView(v: ScopeView) {
    setView(v);
    setBooksCompany(null);
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
    <div className="flex flex-col gap-4 lg:gap-5">
      <VaultAutoLock />
      <div className="flex flex-wrap items-center gap-3">
        {/* Bills and Spending have their own owner choice, so this switch steps aside there. */}
        {!OWN_ENTITY.has(tab) && <>
        <div role="radiogroup" aria-label="Show" className="inline-flex max-w-full overflow-x-auto rounded-full border border-zinc-300 bg-surface p-0.5 [scrollbar-width:none] dark:border-zinc-700">
          {([
            ["all", "All"],
            ["personal", "Personal"],
            ...COMPANIES.map((c) => [c.value, c.label] as const),
          ] as const).map(([v, label]) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              onClick={() => chooseView(v)}
              className={`shrink-0 rounded-full px-2.5 py-1.5 text-sm sm:px-4 ${
                view === v ? "bg-brand font-medium text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-zinc-500 sm:inline">
          {view === "all"
            ? "Showing everything together"
            : `Showing ${COMPANIES.find((c) => c.value === view)?.legalName ?? "personal"} only`}
        </span>
        </>}
        <CloudBadge state={cloud} />
      </div>
      <nav className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-zinc-200/60 p-1 [scrollbar-width:none] dark:bg-zinc-900">
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
              {t.id === "overview" && view === "all" ? "Command center" : t.label}
            </button>
          ))}
        </div>
        {/* Backups: buttons on wider screens, tucked into a small menu on phones. */}
        <details className="relative shrink-0 sm:hidden">
          <summary className={`${ghostButtonClass} list-none whitespace-nowrap`}>Backup ▾</summary>
          <div className="absolute right-0 z-20 mt-1 flex w-44 flex-col gap-1 rounded-lg border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800">
            <button className="rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={exportData}>Export backup</button>
            <button className="rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => fileRef.current?.click()}>Import backup</button>
          </div>
        </details>
        <div className="hidden gap-2 sm:flex">
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

      {tab === "overview" &&
        (view === "all" ? (
          <CommandCenter
            data={data}
            goTo={setTab}
            openBooks={(c) => {
              setBooksCompany(c);
              setTab("books");
            }}
          />
        ) : (
          <Overview data={shown} goTo={setTab} />
        ))}
      {tab === "accounts" && (
        <>
          <BankLinks data={shown} />
          <Accounts data={shown} />
        </>
      )}
      {tab === "transactions" && <Transactions data={shown} categories={categories} />}
      {tab === "bills" && <Bills data={data} categories={categories} goTo={setTab} initialEntity={entityFor(view)} />}
      {tab === "spending" && <Spending data={data} goTo={setTab} initialEntity={entityFor(view)} />}
      {tab === "budgets" && <Budgets data={shown} categories={categories} />}
      {tab === "institutions" && <Institutions data={shown} />}
      {tab === "receipts" && <Receipts data={shown} />}
      {tab === "documents" && <Documents data={data} goTo={setTab} />}
      {tab === "taxes" && <Taxes data={shown} />}
      {tab === "books" && (
        <Books
          key={booksCompany ?? view}
          data={data}
          goTo={setTab}
          initialCompany={booksCompany ?? (view === "gladiator" ? "gladiator" : "business")}
          quickBooksNotice={quickBooksNotice}
        />
      )}
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
