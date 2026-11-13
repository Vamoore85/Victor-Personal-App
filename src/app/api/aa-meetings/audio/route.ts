import { connection } from "next/server";
import { downloadTranscript, playAudio, uploadAudio } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

// POST ?meetingId&uploadId&part=N (audio bytes) or ?meetingId&uploadId&finish=1 (JSON). Owner only.
export async function POST(req: Request) {
  await connection();
  return uploadAudio(req, cloudStore);
}

// GET ?meetingId&play=1: the owner's audio, one stored part per Range request. GET ?meetingId: the transcript as plain text.
export async function GET(req: Request) {
  await connection();
  return new URL(req.url).searchParams.get("play") === "1" ? playAudio(req, cloudStore) : downloadTranscript(req, cloudStore);
}
