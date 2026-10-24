import { handle } from "@/lib/plaid-server";

// The browser says how far opening Plaid's window got when it fails (no account
// details), so a stuck or failed reconnect shows up in the site's logs.
const STAGES = new Set(["token", "script", "window", "exit"]);
export const POST = handle(async (body) => {
  const stage = STAGES.has(String(body.stage)) ? String(body.stage) : "other";
  const code = typeof body.code === "string" ? body.code.replace(/[^A-Z0-9_]/g, "").slice(0, 40) : "";
  console.log(`plaid link problem: stage=${stage} code=${code || "none"}`);
  return { ok: true };
});
