import { connection } from "next/server";
import { databaseUrl, dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Cloud copy of the Financial Center. The browser keeps a local copy too and
// sends each change here with the revision it started from.

const KEY = "money";
const MAX_BYTES = 8 * 1024 * 1024;

function guard(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!signedIn(req)) return Response.json({ error: "Sign in first." }, { status: 401 });
  return null;
}

function failed(e: unknown) {
  console.error("money sync", e);
  return Response.json({ error: diagnose(e) }, { status: 502 });
}

// A plain-English reason shown in the app, without any part of the
// connection string or password.
function diagnose(e: unknown) {
  const err = e as { code?: string; message?: string };
  const code = err?.code ?? "";
  const msg = String(err?.message ?? "");
  const url = databaseUrl();
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "The database link in Vercel isn't a valid link. If the password has symbols like @ # / ? %, reset it to letters and numbers only and paste the link again.";
  }
  if (url.includes("[YOUR-PASSWORD]") || url.includes("YOUR-PASSWORD"))
    return "The database link still says [YOUR-PASSWORD]. Replace that part with your database password, without the brackets.";
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(host) && /ENOTFOUND|ENETUNREACH|EAI_AGAIN|EHOSTUNREACH/.test(code + msg))
    return "The database link is Supabase's \"Direct connection\", which Vercel can't reach. Use the \"Transaction pooler\" link instead (it ends in pooler.supabase.com:6543).";
  if (code === "28P01" || /password authentication failed/i.test(msg)) return wrongPasswordHint(url);
  if (/Tenant or user not found/i.test(msg))
    return "Supabase didn't recognize the user in the link. Copy the pooler link fresh from Supabase's Connect button.";
  if (/ENOTFOUND|EAI_AGAIN/.test(code + msg)) return `The database address (${host}) couldn't be found. Copy the link fresh from Supabase.`;
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(code + msg)) return `The database (${host}) didn't answer. Check that the Supabase project isn't paused.`;
  return `Couldn't reach the database (${code || msg.slice(0, 80) || "unknown error"}).`;
}

export async function GET(req: Request) {
  await connection();
  const denied = guard(req);
  if (denied) return denied;
  if (!dbConfigured()) return Response.json({ configured: false });
  try {
    const doc = await readDoc(KEY);
    return Response.json({ configured: true, rev: doc?.rev ?? 0, data: doc?.data ?? null });
  } catch (e) {
    return failed(e);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!dbConfigured()) return Response.json({ error: "No database yet." }, { status: 503 });
  const text = await req.text();
  if (text.length > MAX_BYTES) return Response.json({ error: "Too much data to save at once." }, { status: 413 });
  let body: { rev?: unknown; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  if (typeof body.rev !== "number" || typeof body.data !== "object" || body.data === null) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const result = await writeDoc(KEY, body.rev, body.data);
    if (!result.ok) return Response.json({ conflict: true, rev: result.current.rev, data: result.current.data }, { status: 409 });
    return Response.json({ rev: result.rev });
  } catch (e) {
    return failed(e);
  }
}

// Clues about the password in the link, never the password itself.
function wrongPasswordHint(url: string) {
  const u = new URL(url);
  let pw = u.password;
  try {
    pw = decodeURIComponent(pw);
  } catch {
    /* keep as typed */
  }
  const kind = u.hostname.includes("pooler.supabase.com") ? "pooler" : "direct";
  const clues: string[] = [];
  if (!pw) clues.push("the link has no password in it");
  if (/[[\]]/.test(pw)) clues.push("the password still has [ ] brackets around it; remove them");
  if (/YOUR-PASSWORD/i.test(pw)) clues.push("it still says YOUR-PASSWORD");
  if (/\s/.test(pw)) clues.push("the password has a space in it");
  if (/[@#/?%:]/.test(pw)) clues.push("the password has a symbol (@ # / ? % :) that can break the link");
  const sum = clues.length ? ` Clues: ${clues.join("; ")}.` : "";
  return `Supabase rejected the password in the link (a ${kind} link; the password in it is ${pw.length} characters long).${sum} Check it matches the new database password exactly, then save the link again in Vercel.`;
}
