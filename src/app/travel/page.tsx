import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { Travel } from "@/features/travel/Travel";

export const metadata: Metadata = { title: "Travel & Vacation" };

export default function TravelPage() {
  return (
    <div>
      <PageHeader title="Travel & Vacation" subtitle="Trips, bookings, packing lists and the places you want to go." />
      <Travel />
    </div>
  );
}
