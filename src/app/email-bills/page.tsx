import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { EmailBillsScreen } from "@/features/gmail/EmailBills";

export const metadata: Metadata = { title: "Email bills" };

export default function EmailBillsPage() {
  return (
    <div>
      <PageHeader title="Email bills" subtitle="Bills and receipts found in your Gmail, for you to review. Read-only." />
      <EmailBillsScreen />
    </div>
  );
}
