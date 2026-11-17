import { connection } from "next/server";
import { downloadRecord } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

export async function GET(req: Request) {
  await connection();
  return downloadRecord(req, cloudStore);
}
