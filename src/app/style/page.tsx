import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Style } from "@/features/style/Style";

export const metadata: Metadata = { title: "Fashion & Clothes" };

export default function StylePage() {
  return (
    <div>
      <PageHeader title="Fashion & Clothes" subtitle="Your closet, outfits, wish list and sizes." />
      <Style />
    </div>
  );
}
