import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Ideas } from "@/features/ideas/Ideas";

export const metadata: Metadata = { title: "Ideas" };

export default function IdeasPage() {
  return (
    <div>
      <PageHeader title="Ideas" subtitle="A free-form place to dump ideas. Stored only in this browser." />
      <Ideas />
    </div>
  );
}
