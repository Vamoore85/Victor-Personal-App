import { connection } from "next/server";
import { uploadEvidence } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

// POST ?meetingId=<id>&name=<file name>, with the file's bytes as the body.
export async function POST(req: Request) {
  await connection();
  return uploadEvidence(req, cloudStore);
}
