import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { IntegrationsScreen } from "@/features/integrations/Integrations";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <div>
      <PageHeader title="Integrations" subtitle="Every service Maverick connects to, what it can see, and when it last synced." />
      <IntegrationsScreen />
    </div>
  );
}
