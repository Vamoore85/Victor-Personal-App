import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Ideas } from "@/features/ideas/Ideas";

export const metadata: Metadata = { title: "Ideas" };

export default function IdeasPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <PageHeader title="Ideas" subtitle="A free-form place to dump ideas. Stored only in this browser." />
      <Ideas />
    </main>
  );
}
