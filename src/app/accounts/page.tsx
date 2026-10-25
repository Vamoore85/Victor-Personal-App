import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AccountsOverview } from "@/features/money/AccountsPage";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsRoute() {
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Every account, bill and login by company, and what each one leaves you with." />
      <AccountsOverview />
    </div>
  );
}
