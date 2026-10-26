import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ScanPanel } from "@/features/receipts/ScanReceipt";

export const metadata: Metadata = { title: "Scan receipt" };

export default function ScanPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeader title="Scan receipt" subtitle="Snap it, check it, done. It files into your receipt folders by year." />
      <ScanPanel big />
    </div>
  );
}
