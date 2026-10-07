import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Research } from "@/features/research/Research";

export const metadata: Metadata = { title: "Research Center" };

export default function ResearchPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <PageHeader title="Research Center" subtitle="Questions you're digging into, with your notes and sources in one place." />
      <Research />
    </main>
  );
}
