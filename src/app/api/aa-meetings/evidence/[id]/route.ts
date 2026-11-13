import { connection } from "next/server";
import { downloadEvidence } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return downloadEvidence(req, cloudStore, (await params).id);
}
