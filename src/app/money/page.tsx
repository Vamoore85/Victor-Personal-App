import type { Metadata } from "next";
import Link from "next/link";
import { FinancialCenter } from "@/features/money/FinancialCenter";

export const metadata: Metadata = { title: "Financial Center" };

export default function MoneyPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <header className="mb-8">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Financial Center</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Accounts, bills, spending, budgets and Maverick Vault in one place. Stored only in this browser.
        </p>
      </header>
      <FinancialCenter />
    </main>
  );
}
