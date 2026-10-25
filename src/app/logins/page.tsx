import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { LoginsOverview } from "@/features/money/LoginsPage";

export const metadata: Metadata = { title: "Logins" };

export default function LoginsRoute() {
  return (
    <div>
      <PageHeader title="Logins" subtitle="Every website and account you sign in to, in one place. Usernames and passwords show after you unlock your vault." />
      <LoginsOverview />
    </div>
  );
}
