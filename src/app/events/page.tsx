import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Events } from "@/features/events/Events";

export const metadata: Metadata = { title: "Events & Speakers" };

export default function EventsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
      <PageHeader title="Events & Speakers" subtitle="Special events to attend or host, and the speakers worth following." />
      <Events />
    </main>
  );
}
