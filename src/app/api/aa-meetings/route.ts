import { connection } from "next/server";
import { getMeetings, postMeetings } from "@/features/aa-meetings/api";
import { cloudStore } from "@/features/aa-meetings/server";

export async function GET(req: Request) {
  await connection();
  return getMeetings(req, cloudStore);
}

export async function POST(req: Request) {
  await connection();
  return postMeetings(req, cloudStore);
}
