import { connection } from "next/server";
import { signedIn } from "@/lib/plaid-server";

/*
 * A website's own icon, for the login portal. The server fetches it from that
 * website itself (its <link rel="icon"> or /favicon.ico), so no outside logo
 * service ever sees your list, and each website only learns that its own icon
 * was asked for, by this server rather than your browser.
 */

const MAX_BYTES = 300_000;
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

function allowed(host: string) {
  return HOST.test(host) && !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

/** Fetches a public https page, following a few redirects only to other public hosts. */
async function get(url: string, accept: string): Promise<Response | null> {
  let target = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (target.protocol !== "https:" || !allowed(target.hostname)) return null;
    const res = await fetch(target, { redirect: "manual", headers: { accept, "user-agent": "Mozilla/5.0 (Maverick logo fetch)" }, signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (!res) return null;
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res.ok ? res : null;
    target = new URL(next, target);
  }
  return null;
}

async function readCapped(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The icon links a home page names, best first (apple-touch-icon is usually the largest). */
function iconLinks(html: string, base: URL) {
  const found: { href: string; rank: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || !/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const size = Number(/\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0);
    found.push({ href: new URL(href.replace(/&amp;/g, "&"), base).toString(), rank: (rel.includes("apple") ? 1000 : 0) + Math.min(size, 512) });
  }
  return found.sort((a, b) => b.rank - a.rank).map((f) => f.href);
}

async function iconFor(host: string): Promise<{ body: Buffer; type: string } | null> {
  const home = `https://${host}/`;
  const page = await get(home, "text/html");
  const html = page && (page.headers.get("content-type") ?? "").includes("html") ? (await readCapped(page))?.toString("utf8") ?? "" : "";
  for (const url of [...iconLinks(html, new URL(page?.url || home)).slice(0, 3), `https://${host}/favicon.ico`]) {
    if (url.startsWith("data:")) continue;
    const res = await get(url, "image/*");
    const type = res?.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res || !(type.startsWith("image/") || url.endsWith(".ico"))) continue;
    const body = await readCapped(res);
    if (body && body.length > 0) return { body, type: type.startsWith("image/") ? type : "image/x-icon" };
  }
  return null;
}

export async function GET(req: Request) {
  await connection();
  if (!signedIn(req)) return new Response(null, { status: 401 });
  const host = (new URL(req.url).searchParams.get("host") ?? "").toLowerCase().replace(/^www\./, "");
  if (!allowed(host)) return new Response(null, { status: 400 });
  // Try the site's own address first, then its main domain (e.g. mychart.example.org -> example.org).
  const main = host.split(".").slice(-2).join(".");
  const icon = (await iconFor(host)) ?? (main !== host ? await iconFor(main) : null);
  if (!icon) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=86400" } });
  return new Response(new Uint8Array(icon.body), {
    headers: {
      "content-type": icon.type === "image/svg+xml" ? "image/svg+xml" : icon.type,
      "cache-control": "private, max-age=604800",
      "x-content-type-options": "nosniff",
      // An SVG opened on its own can't run anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
