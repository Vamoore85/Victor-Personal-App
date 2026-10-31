import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { CODE_ALPHABET, normalizeCode } from "./wade-code";

export { normalizeCode };

/*
 * Read-only money access for the same local Wade on Victor's Mac.
 *
 * Wade makes its own random token on the Mac and sends only its SHA-256 hash to
 * start a link, so Maverick never stores or returns a usable secret. The link
 * does nothing until Victor approves its short code from a full Maverick sign-in.
 * After that, the token reads one summary (never logins, files or the vault) and
 * can be disconnected at any time.
 */

export const WADE_LINKS_DOC = "wade-links";
export const PENDING_MINUTES = 10;
export const LINK_DAYS = 90;
export const MAX_PENDING = 5;
export const MAX_LINKS = 20;

export type WadeLink = {
  id: string;
  userCode: string; // shown in Wade and typed/confirmed in Maverick
  tokenHash: string; // sha256 hex of Wade's token; the token itself never reaches Maverick's storage
  status: "pending" | "approved" | "revoked";
  createdAt: number;
  approvedAt?: number;
  expiresAt: number;
  lastUsedAt?: number;
};

export type WadeLinks = { links: WadeLink[] };

export function asLinks(data: unknown): WadeLinks {
  const links = (data as WadeLinks | null)?.links;
  return { links: Array.isArray(links) ? links.filter((l) => l && typeof l.tokenHash === "string") : [] };
}

/** Wade's token: 32 random bytes in base64url (43 characters). */
export function validToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function validHash(hash: unknown): hash is string {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}

export function bearer(header: string | null) {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? "");
  return m ? m[1] : null;
}

function newCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}


/** Drops expired pending links and expired approvals; revoked ones stay briefly for the list, then go. */
export function prune(state: WadeLinks, now: number): WadeLinks {
  return {
    links: state.links.filter((l) =>
      l.status === "approved" ? l.expiresAt > now : l.status === "pending" ? l.expiresAt > now : now - l.createdAt < LINK_DAYS * 864e5),
  };
}

export function startLink(state: WadeLinks, tokenHash: string, now: number, id: string) {
  const s = prune(state, now);
  if (s.links.some((l) => l.tokenHash === tokenHash)) throw new LinkError("This Wade request already exists.", 409);
  const pending = s.links.filter((l) => l.status === "pending");
  if (pending.length >= MAX_PENDING) throw new LinkError("Too many waiting Wade requests. Try again in a few minutes.", 429);
  if (s.links.length >= MAX_LINKS) throw new LinkError("Disconnect an old Wade link in Maverick first.", 409);
  let userCode = newCode();
  while (s.links.some((l) => l.userCode === userCode)) userCode = newCode();
  const link: WadeLink = { id, userCode, tokenHash, status: "pending", createdAt: now, expiresAt: now + PENDING_MINUTES * 6e4 };
  return { state: { links: [...s.links, link] }, link };
}

export function approveLink(state: WadeLinks, code: string, now: number) {
  const s = prune(state, now);
  const link = s.links.find((l) => l.userCode === code && l.status === "pending");
  if (!link) throw new LinkError("That code isn't waiting. Start again from Wade on your Mac.", 404);
  const approved: WadeLink = { ...link, status: "approved", approvedAt: now, expiresAt: now + LINK_DAYS * 864e5 };
  return { state: { links: s.links.map((l) => (l.id === link.id ? approved : l)) }, link: approved };
}

export function revokeLink(state: WadeLinks, id: string) {
  if (!state.links.some((l) => l.id === id)) throw new LinkError("That Wade link wasn't found.", 404);
  return { links: state.links.map((l) => (l.id === id ? { ...l, status: "revoked" as const, expiresAt: 0 } : l)) };
}

/** The link this token belongs to, compared in constant time. Any status; callers decide. */
export function findByToken(state: WadeLinks, token: string) {
  const want = Buffer.from(hashToken(token), "hex");
  return state.links.find((l) => validHash(l.tokenHash) && timingSafeEqual(Buffer.from(l.tokenHash, "hex"), want)) ?? null;
}

export function linkStatus(link: WadeLink | null, now: number): "pending" | "approved" | "expired" | "revoked" | "unknown" {
  if (!link) return "unknown";
  if (link.status === "revoked") return "revoked";
  if (link.expiresAt <= now) return "expired";
  return link.status;
}

/** What the Maverick page shows: never the hash. */
export function publicLinks(state: WadeLinks, now: number) {
  return prune(state, now).links.map((l) => ({
    id: l.id, userCode: l.userCode, status: linkStatus(l, now), createdAt: l.createdAt,
    approvedAt: l.approvedAt ?? null, expiresAt: l.expiresAt, lastUsedAt: l.lastUsedAt ?? null,
  }));
}

export class LinkError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
