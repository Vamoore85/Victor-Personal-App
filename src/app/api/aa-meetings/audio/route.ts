import { connection } from "next/server";
import { downloadTranscript, uploadAudio } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

// POST ?meetingId&uploadId&part=N (audio bytes) or ?meetingId&uploadId&finish=1 (JSON). Owner only.
export async function POST(req: Request) {
  await connection();
  return uploadAudio(req, cloudStore);
}

// GET ?meetingId: the owner's transcript as plain text.
export async function GET(req: Request) {
  await connection();
  return downloadTranscript(req, cloudStore);
}
