import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Tracker } from "@/features/aa-meetings/Tracker";

export const metadata: Metadata = { title: "AA Meetings" };

export default function AAMeetingsPage() {
  return (
    <div>
      <PageHeader title="AA Meetings" subtitle="Plans, attendance you confirm, supporting records and court reports." />
      <Tracker />
    </div>
  );
}
