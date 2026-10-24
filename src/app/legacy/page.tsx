import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Legacy } from "@/features/legacy/Legacy";

export const metadata: Metadata = { title: "Legacy" };

export default function LegacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Legacy"
        subtitle="Your will, final wishes and instructions for the people you leave behind. Locked with your Maverick Vault password."
      />
      <Legacy />
    </div>
  );
}
