import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Health } from "@/features/health/Health";

export const metadata: Metadata = { title: "Health & Fitness" };

export default function HealthPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <PageHeader title="Health & Fitness" subtitle="Workouts, weight, sleep and habits, checked in day by day." />
      <Health />
    </main>
  );
}
