import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Events } from "@/features/events/Events";

export const metadata: Metadata = { title: "Events & Speakers" };

export default function EventsPage() {
  return (
    <div>
      <PageHeader title="Events & Speakers" subtitle="Special events to attend or host, and the speakers worth following." />
      <Events />
    </div>
  );
}
