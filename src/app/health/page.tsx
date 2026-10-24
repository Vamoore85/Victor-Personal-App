import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Health } from "@/features/health/Health";

export const metadata: Metadata = { title: "Health & Fitness" };

export default function HealthPage() {
  return (
    <div>
      <PageHeader title="Health & Fitness" subtitle="Workouts, weight, sleep and habits, checked in day by day." />
      <Health />
    </div>
  );
}
