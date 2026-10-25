import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { FinancialCenter } from "@/features/money/FinancialCenter";

export const metadata: Metadata = { title: "Financial Center" };

export default function MoneyPage() {
  return (
    <div>
      <PageHeader
        title="Money"
        subtitle="Your balances, upcoming bills, and recent activity."
      />
      <Suspense fallback={<p>Loading your money…</p>}><FinancialCenter /></Suspense>
    </div>
  );
}
