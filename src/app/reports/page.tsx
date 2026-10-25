import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ReportsPage } from "@/features/money/reports-ui";

export const metadata: Metadata = { title: "Reports" };
export default function Page() {
  return <div><PageHeader title="Reports" subtitle="Your financial information, ready to read or download." /><ReportsPage /></div>;
}
