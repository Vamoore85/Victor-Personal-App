import { connection } from "next/server";
import { downloadConfirmationFile } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  await connection();
  return downloadConfirmationFile(req, cloudStore, (await params).id);
}
