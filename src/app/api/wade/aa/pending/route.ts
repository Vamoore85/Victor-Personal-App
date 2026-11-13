import { connection } from "next/server";
import { cloudStore } from "@/features/aa-meetings/server";
import { wadePending } from "@/features/aa-meetings/wade";

// Raven on Victor's Mac only, with its approved Wade link token (see src/features/aa-meetings/wade.ts).
export async function GET(req: Request) {
  await connection();
  return wadePending(req, cloudStore);
}

export function POST() {
  return new Response(null, { status: 405, headers: { "Cache-Control": "no-store", Allow: "GET" } });
}
