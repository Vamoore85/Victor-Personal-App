import { gunzipSync, gzipSync } from "node:zlib";
import { connection } from "next/server";
import { databaseUrl, dbConfigured, readDoc, writeDoc } from "@/lib/db";
import { applyPendingBills } from "@/lib/pending-bills";
import { applyPendingImport } from "@/lib/pending-import";
import { applyPendingSites } from "@/lib/pending-sites";
import { accountDiag, asMoney, billDiag } from "@/lib/money-doc";
import { ACCOUNT_RULES, cleanAccounts } from "@/features/money/accounts-fix";
import { lastPayments, linkSiteCosts, SITE_COST_RULES } from "@/features/money/site-costs";
import { sameOrigin, signedIn } from "@/lib/plaid-server";

// Cloud copy of the Financial Center. The browser keeps a local copy too and
// sends each change here with the revision it started from.

const KEY = "money";
const MAX_BYTES = 40 * 1024 * 1024;

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
    let doc = await readDoc(KEY);
    // Merge in statements waiting in PENDING_IMPORT, if any.
    const merged = applyPendingImport(doc?.data ?? null);
    if (merged) {
      const saved = await writeDoc(KEY, doc?.rev ?? 0, merged);
      if (saved.ok) doc = { rev: saved.rev, data: merged };
    }
    // Each real bank account once, with the company you gave it (see accounts-fix.ts). Saved back right away.
    if (doc?.data) {
      const fix = cleanAccounts(asMoney(doc.data));
      if (fix.changed) {
        const saved = await writeDoc(KEY, doc.rev, fix.data);
        if (saved.ok) doc = { rev: saved.rev, data: fix.data };
        console.log(`money clean-up: accounts ${fix.before} -> ${fix.after}, merged=${fix.merged}, unassigned=${fix.unassigned}, corrected=${fix.corrected.join(",") || "none"}, saved=${saved.ok}`);
      }
      // Bills waiting in PENDING_BILLS, after the clean-up so each lands on the one copy of its account.
      const bills = applyPendingBills(doc.data);
      if (bills) {
        const saved = await writeDoc(KEY, doc.rev, bills.data);
        if (saved.ok) doc = { rev: saved.rev, data: bills.data };
        console.log(`money bills import: added=${bills.added}, saved=${saved.ok}`);
      }
      // Websites waiting in PENDING_SITES (names and links only).
      const sites = applyPendingSites(doc.data);
      if (sites) {
        const saved = await writeDoc(KEY, doc.rev, sites.data);
        if (saved.ok) doc = { rev: saved.rev, data: sites.data };
        console.log(`money sites import: added=${sites.added}, noLink=${sites.noLink}, saved=${saved.ok}`);
      }
      // Each website's monthly cost, from the one saved bill that clearly belongs to it (see site-costs.ts).
      const costs = linkSiteCosts(asMoney(doc.data));
      if (costs) {
        const saved = await writeDoc(KEY, doc.rev, costs.data);
        if (saved.ok) doc = { rev: saved.rev, data: costs.data };
        console.log(`money site costs: linked=${costs.linked}, saved=${saved.ok}`);
      }
      console.log(`money accounts: ${accountDiag(doc.data)}`);
      // How many websites on Logins have a payment found, only a saved bill, or neither (counts only, never names or amounts).
      const clean = cleanAccounts(asMoney(doc.data)).data;
      const paid = lastPayments(clean);
      const billed = new Set(clean.bills.map((b) => b.institutionId).filter(Boolean));
      const saved = clean.institutions.filter((i) => !paid.has(i.id) && (billed.has(i.id) || i.cost?.kind === "manual")).length;
      console.log(`money logins: sites=${clean.institutions.length} paymentFound=${paid.size} savedBillOnly=${saved} notRecorded=${clean.institutions.length - paid.size - saved} billsLinked=${billed.size}/${clean.bills.length}`);
      for (const line of billDiag(doc.data).split("\n")) console.log(`money bills check: ${line}`);
    }
    return packed({ configured: true, rev: doc?.rev ?? 0, data: doc?.data ?? null });
  } catch (e) {
    return failed(e);
  }
}

export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  if (!dbConfigured()) return Response.json({ error: "No database yet." }, { status: 503 });
  // Big saves arrive gzipped, so years of bank history fit under the hosting's 4.5 MB request limit.
  const text = req.headers.get("x-body-encoding") === "gzip" ? gunzipSync(Buffer.from(await req.arrayBuffer())).toString("utf8") : await req.text();
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
    // A save only lands on the latest copy (rev check), which the clean-up rules already ran on.
    // Older app code didn't carry that marker; keep it, or the rules would run again on the next load.
    const data = body.data as { accountRules?: unknown; billImports?: unknown; siteImports?: unknown; siteCostRules?: unknown };
    if (typeof data.accountRules !== "number") data.accountRules = ACCOUNT_RULES;
    if (typeof data.siteCostRules !== "number") data.siteCostRules = SITE_COST_RULES;
    // Same for the workbook bills and websites already added: keep the lists, or deleted ones would come back.
    if (!Array.isArray(data.billImports) || !Array.isArray(data.siteImports)) {
      const current = (await readDoc(KEY))?.data as { billImports?: unknown; siteImports?: unknown } | undefined;
      if (!Array.isArray(data.billImports) && Array.isArray(current?.billImports)) data.billImports = current.billImports;
      if (!Array.isArray(data.siteImports) && Array.isArray(current?.siteImports)) data.siteImports = current.siteImports;
    }
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

// Large answers go out gzipped: the hosting refuses function responses over 4.5 MB.
function packed(value: unknown) {
  const text = JSON.stringify(value);
  if (text.length < 100_000) return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return new Response(gzipSync(text), { headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store" } });
}
