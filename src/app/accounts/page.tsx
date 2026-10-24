import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { AccountsOverview } from "@/features/money/AccountsPage";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsRoute() {
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Every account by company: what's in it, what's owed, and whether it's live from the bank." />
      <AccountsOverview />
    </div>
  );
}
