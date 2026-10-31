import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { MoneyAccess } from "@/features/wade/MoneyAccess";

export const metadata: Metadata = { title: "Wade money access" };

export default function WadeConnectPage() {
  return (
    <div>
      <PageHeader title="Wade money access" subtitle="Let the Wade on your Mac read your Financial Center, read only." />
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <MoneyAccess />
      </Suspense>
    </div>
  );
}
