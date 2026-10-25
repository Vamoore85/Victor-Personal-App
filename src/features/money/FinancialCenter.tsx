"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ScopeContext, filterByScope, type ScopeView } from "./scope";
import { cloudErrorMessage, importMoneyData, retryCloud, useCloudState, useMoneyData } from "./store";
import { exportEncryptedVault, importEncryptedVault } from "./vault";
import { DEFAULT_CATEGORIES } from "./types";
import { categoriesInUse, today } from "./calc";
import { Accounts, Budgets, Transactions } from "./sections";
import { Overview } from "./outlook-ui";
import { AssignAccounts } from "./assign-ui";
import { assignedOnly } from "./accounts-fix";
import { RecurringBills } from "./recurring-ui";
import { RecurringEmailBills } from "@/features/gmail/RecurringEmailBills";
import { Bills } from "./bill-intel-ui";
import { Spending } from "./spending-ui";
import { Documents } from "./documents-ui";
import { BriefingView } from "./briefing-ui";
import { Institutions } from "./institutions";
import { VaultAutoLock } from "./vault-ui";
import { BankLinks, useAutoSync } from "./plaid";
import { setMode } from "./intel-shared";
import { ghostButtonClass } from "./ui";
import { Books } from "./books-ui";
import { BUSINESS_CATEGORY_NAMES } from "./books";
import { CommandCenter } from "./command-center";
import { Receipts } from "./receipts";
import { Taxes } from "./taxes";
import { clearQuickBooksNotice, quickBooksNotice as readQuickBooksNotice } from "./quickbooks";
import { COMPANIES, isCompany, type Company } from "./types";

// One place for each job. Bills is the default; the optional summary lives under Tools.
const MAIN = [
  { id: "bills", label: "Bills" },
  { id: "spending", label: "Spending" },
  { id: "accounts", label: "Bank accounts" },
];

const DETAILS: { id: string; label: string; scoped?: boolean }[] = [
  { id: "overview", label: "Money summary" },
  { id: "transactions", label: "Edit transactions", scoped: true },
  { id: "calendar", label: "Bill calendar" },
  { id: "briefing", label: "Briefing" },
  { id: "command", label: "Command center" },
  { id: "books", label: "Company books" },
  { id: "budgets", label: "Budgets", scoped: true },
  { id: "receipts", label: "Receipt photos", scoped: true },
  { id: "documents", label: "Documents" },
  { id: "taxes", label: "Taxes", scoped: true },
  { id: "institutions", label: "Maverick Vault", scoped: true },
];

export function FinancialCenter() {
  const searchParams = useSearchParams();
  const data = useMoneyData();
  const cloud = useCloudState();
  const [chosenTab, setTab] = useState<string | null>(() => {
    if (readQuickBooksNotice()) return "books";
    const asked = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    return asked && [...MAIN, ...DETAILS].some((t) => t.id === asked) ? asked : null;
  });
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
  const requested = searchParams.get("tab");
  const tab = chosenTab ?? (requested && [...MAIN, ...DETAILS].some((t) => t.id === requested) ? requested : "bills");

  const personalCategories = categoriesInUse(filterByScope(data, "personal"), DEFAULT_CATEGORIES);
  const categories =
    isCompany(view === "all" ? undefined : view)
      ? BUSINESS_CATEGORY_NAMES
      : view === "personal"
        ? personalCategories
        : [...new Set([...personalCategories, ...BUSINESS_CATEGORY_NAMES])];

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

  const detailTab = DETAILS.find((t) => t.id === tab);
  // Main views are always all three entities together; the Show switch only appears in a few detail views.
  const scoped = detailTab?.scoped ? view : "all";
  const shownHere = filterByScope(data, scoped);

  return (
    <ScopeContext.Provider value={scoped}>
    <div className="flex flex-col gap-5 lg:gap-6">
      <VaultAutoLock />
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Money">
        <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-full bg-zinc-200/60 p-1 [scrollbar-width:none] sm:gap-1 dark:bg-zinc-900">
          {MAIN.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`min-h-11 shrink-0 rounded-full px-3 py-2 text-sm sm:px-4 sm:text-base ${
                tab === t.id
                  ? "bg-white font-medium text-brand shadow-sm dark:bg-zinc-800"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Link href="/email-bills" className={`${ghostButtonClass} whitespace-nowrap`}>Receipts</Link>
        <details className="relative shrink-0" data-testid="details-menu">
          <summary aria-label="More tools" className={`${ghostButtonClass} list-none whitespace-nowrap ${detailTab ? "text-brand" : ""}`}>
            <span className="hidden sm:inline">{detailTab ? detailTab.label : "Tools"} ▾</span>
            <span className="sm:hidden" aria-hidden>
              •••
            </span>
          </summary>
          <div className="absolute right-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-xl border border-zinc-200 bg-surface p-1 shadow-lg dark:border-zinc-800">
            <Link href="/reports" className="rounded-lg px-3 py-3 text-left text-sm font-medium text-brand">Reports &amp; downloads</Link>
            {DETAILS.map((t) => (
              <button
                key={t.id}
                className={`rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${tab === t.id ? "font-medium text-brand" : ""}`}
                onClick={(e) => {
                  setTab(t.id);
                  (e.currentTarget.closest("details") as HTMLDetailsElement).open = false;
                }}
              >
                {t.label}
              </button>
            ))}
            <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
            <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={exportData}>Export backup</button>
            <button className="rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => fileRef.current?.click()}>Import backup</button>
          </div>
        </details>
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
      </nav>
      <CloudBadge state={cloud} />
      {tab === "bills" && <p className="text-sm text-zinc-500">What is coming due, how much, and when.</p>}
      {tab === "spending" && <p className="text-sm text-zinc-500">Past purchases and where your money went.</p>}
      {tab === "accounts" && <p className="text-sm text-zinc-500">Bank balances, account names, and connections.</p>}

      {detailTab?.scoped && (
        <div role="radiogroup" aria-label="Show" className="inline-flex max-w-full self-start overflow-x-auto rounded-full border border-zinc-300 bg-surface p-0.5 [scrollbar-width:none] dark:border-zinc-700">
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
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs sm:px-3 ${
                view === v ? "bg-brand font-medium text-on-brand" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "overview" && <Overview data={data} onSettings={() => setTab("accounts")} />}
      {tab === "spending" && <Spending data={assignedOnly(data)} goTo={setTab} initialEntity="all" />}
      {tab === "bills" && <><RecurringEmailBills /><RecurringBills data={data} categories={categories} /></>}
      {tab === "accounts" && (
        <>
          <AssignAccounts data={data} />
          <Link href="/integrations" className="self-start text-sm text-zinc-500 underline hover:text-brand">
            All connections (banks, QuickBooks, Outlook, home apps) are on the Integrations page
          </Link>
          <BankLinks
            data={data}
            onBriefing={() => {
              setMode("real");
              setTab("bills");
            }}
          />
          <Accounts data={data} />
        </>
      )}
      {tab === "briefing" && <BriefingView data={data} goTo={setTab} />}
      {tab === "transactions" && <Transactions data={shownHere} categories={categories} />}
      {tab === "calendar" && <Bills data={data} categories={categories} goTo={setTab} />}
      {tab === "budgets" && <Budgets data={shownHere} categories={categories} />}
      {tab === "institutions" && <Institutions data={shownHere} />}
      {tab === "receipts" && <Receipts data={shownHere} />}
      {tab === "documents" && <Documents data={data} goTo={setTab} />}
      {tab === "taxes" && <Taxes data={shownHere} />}
      {tab === "command" && (
        <CommandCenter
          data={data}
          goTo={setTab}
          openBooks={(c) => {
            setBooksCompany(c);
            setTab("books");
          }}
        />
      )}
      {tab === "books" && (
        <Books key={booksCompany ?? "books"} data={data} goTo={setTab} initialCompany={booksCompany ?? "business"} quickBooksNotice={quickBooksNotice} />
      )}
    </div>
    </ScopeContext.Provider>
  );
}

function CloudBadge({ state }: { state: ReturnType<typeof useCloudState> }) {
  if (state === "off") return <span className="text-xs text-zinc-400">Saved on this device only</span>;
  if (state === "error")
    return (
      <span className="max-w-md text-xs text-rose-600 dark:text-rose-400">
        <button className="underline" onClick={retryCloud}>
          Couldn&apos;t save online. Try again
        </button>
        {cloudErrorMessage() && <span className="mt-1 block">{cloudErrorMessage()}</span>}
      </span>
    );
  return null; // saving normally stays out of the way
}
