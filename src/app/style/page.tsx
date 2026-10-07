import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Style } from "@/features/style/Style";

export const metadata: Metadata = { title: "Fashion & Clothes" };

export default function StylePage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <PageHeader title="Fashion & Clothes" subtitle="Your closet, outfits, wish list and sizes." />
      <Style />
    </main>
  );
}
