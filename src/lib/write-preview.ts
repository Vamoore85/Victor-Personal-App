import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * A write to Microsoft 365 (send an email, post in Teams, create, change or
 * cancel an event) only goes through with a token from its preview. The token
 * signs exactly what the preview showed, for ten minutes, so what's sent is
 * what the owner saw: change a word and the preview has to be shown again.
 */

const TTL_MS = 10 * 60 * 1000;

const key = () => {
  // Without the app password there's no secret to sign with, so nothing can be confirmed.
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD isn't set.");
  return `maverick-write-preview:${process.env.APP_PASSWORD}`;
};

/** Same value, same text, whatever order its keys were in. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const sign = (action: string, payload: unknown, expires: number) => createHmac("sha256", key()).update(`${action}\n${expires}\n${canonical(payload)}`).digest("base64url");

export function previewToken(action: string, payload: unknown, now = Date.now()) {
  const expires = now + TTL_MS;
  return `${expires}.${sign(action, payload, expires)}`;
}

export function checkPreview(action: string, payload: unknown, token: unknown, now = Date.now()) {
  if (typeof token !== "string" || !process.env.APP_PASSWORD) return false;
  const [exp, mac] = token.split(".");
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < now || !mac) return false;
  const want = Buffer.from(sign(action, payload, expires));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
