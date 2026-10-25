import type { Metadata } from "next";
import { LoginsOverview } from "@/features/money/LoginsPage";

export const metadata: Metadata = { title: "Logins" };

// The page draws its own "Master login portal" heading.
export default function LoginsRoute() {
  return <LoginsOverview />;
}
