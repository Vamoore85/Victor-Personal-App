import { connection } from "next/server";
import { downloadReport } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

export async function GET(req: Request) {
  await connection();
  return downloadReport(req, cloudStore);
}
