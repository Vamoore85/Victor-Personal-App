import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import Link from "next/link";
import { WadePanel } from "@/features/wade/WadePanel";

export const metadata: Metadata = { title: "Wade" };

export default function WadePage() {
  return (
    <div>
      <PageHeader title="Wade" subtitle="The same Wade that runs on your Mac, shown inside Maverick." />
      <WadePanel />
      <p className="mt-4 text-sm">
        <Link className="underline" href="/wade/connect">Wade&apos;s money access</Link>
      </p>
    </div>
  );
}
