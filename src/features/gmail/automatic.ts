import { timingSafeEqual } from "node:crypto";

export const AUTO_SCAN_DAYS = 7;
export const AUTO_SCAN_LABEL = "Every 30 minutes";

export function cronAuthorized(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type AutomaticMailState = {
  enabled: boolean;
  lastCheck?: string;
  lastSuccess?: string;
  lastError?: string;
  lastNote?: string;
  looked?: number;
  kept?: number;
};
