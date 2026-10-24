import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FinancialCenter } from "@/features/money/FinancialCenter";

export const metadata: Metadata = { title: "Financial Center" };

export default function MoneyPage() {
  return (
    <div>
      <PageHeader
        title="Financial Center"
        subtitle="Personal money, Maverick and Gladiator's books, bills, budgets and Maverick Vault in one place."
      />
      <FinancialCenter />
    </div>
  );
}
