import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Invest } from "@/features/invest/Invest";

export const metadata: Metadata = { title: "Invest" };

export default function InvestPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <PageHeader
        title="Invest"
        subtitle="Invest in yourself. Design your goals and drag in the books and video clips that get you there."
      />
      <Invest />
    </main>
  );
}
