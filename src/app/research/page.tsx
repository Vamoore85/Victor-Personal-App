import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Research } from "@/features/research/Research";

export const metadata: Metadata = { title: "Research Center" };

export default function ResearchPage() {
  return (
    <div>
      <PageHeader title="Research Center" subtitle="Questions you're digging into, with your notes and sources in one place." />
      <Research />
    </div>
  );
}
