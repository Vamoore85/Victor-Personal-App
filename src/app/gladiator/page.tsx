import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GladiatorScreen } from "@/features/gladiator/Gladiator";

export const metadata: Metadata = { title: "Gladiator 365" };

export default function GladiatorPage() {
  return (
    <div>
      <PageHeader title="Gladiator 365" subtitle="Gladiator Solutions mail and Teams for vic@gladiatoremergence.com. Nothing is sent until you preview and confirm it." />
      <GladiatorScreen />
    </div>
  );
}
