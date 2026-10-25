import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { LoginsOverview } from "@/features/money/LoginsPage";

export const metadata: Metadata = { title: "Logins" };

export default function LoginsRoute() {
  return (
    <div>
      <PageHeader title="Logins" subtitle="Every login by company. Passwords show only after you unlock your Maverick Vault." />
      <LoginsOverview />
    </div>
  );
}
