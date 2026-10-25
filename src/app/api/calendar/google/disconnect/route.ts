import { disconnectGoogle } from "@/lib/calendar";
import { handle } from "../../../microsoft/handle";

// Forgets the Google Calendar sign-in only; Gmail's connection is untouched.
export const POST = handle(async () => {
  await disconnectGoogle();
  return { ok: true };
});
