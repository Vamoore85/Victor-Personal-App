import type { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { BrainDumpScreen } from "@/features/projects/BrainDump";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <div>
      <PageHeader title="Brain Dump" subtitle="Get it out of your head. Sort it into projects, tasks, research or someday when you're ready." />
      <BrainDumpScreen />
    </div>
  );
}
