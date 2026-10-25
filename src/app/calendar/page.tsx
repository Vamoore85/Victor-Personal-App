import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { CalendarScreen } from "@/features/calendar/Calendar";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage() {
  return (
    <div>
      <PageHeader title="Calendar" subtitle="Google Calendar, Gladiator Outlook and bill due dates, each labeled by where it came from." />
      <Suspense fallback={<p>Loading your calendar…</p>}>
        <CalendarScreen />
      </Suspense>
    </div>
  );
}
