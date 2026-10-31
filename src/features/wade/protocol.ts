/*
 * Wade inside Maverick: the parent side of the local frame contract.
 *
 * Wade runs on Victor's Mac and serves a Maverick-only frame at a fixed
 * address. Wade pairs that frame with this exact site itself, through its own
 * owner approval. Maverick listens for one kind of status message and sends
 * exactly one command, the disconnect below. It never passes a URL, origin or
 * token, and never sees Wade's chats, keys or drafts. Nothing here runs on
 * Maverick's server.
 */

export const WADE_ORIGIN = "http://127.0.0.1:8790";
export const WADE_FRAME_URL = `${WADE_ORIGIN}/embed/maverick`;
export const WADE_APP_URL = "wade://open";
/** How long to wait for Wade's first status before calling it unavailable. */
export const WADE_TIMEOUT_MS = 8000;
/** How long Disconnect or sign-out waits for Wade to confirm. */
export const WADE_DISCONNECT_WAIT_MS = 3000;

/** The one command Maverick sends: sign this embed out in Wade (not the Wade app itself). */
export const DISCONNECT_COMMAND = Object.freeze({ type: "wade-local-disconnect" as const });

export type WadeState = "off" | "connecting" | "ready" | "needs-connection" | "unavailable" | "disconnecting" | "disconnected" | "disconnect-unconfirmed";
const FRAME_STATES = ["ready", "needs-connection", "disconnected", "disconnect-unconfirmed"] as const;
export type FrameState = (typeof FRAME_STATES)[number];

/** True only for exactly { type: "wade-local-state", state: <one of Wade's four statuses> }. */
export function isStateMessage(data: unknown): data is { type: "wade-local-state"; state: FrameState } {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  if (Object.getPrototypeOf(data) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(data);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("state")) return false;
  const d = data as Record<string, unknown>;
  return d.type === "wade-local-state" && FRAME_STATES.includes(d.state as FrameState);
}

/**
 * The status a message reports, or null to ignore it. A message counts only
 * if it comes from Wade's exact local origin, from the frame this page made,
 * and has the exact status shape.
 */
export function readFrameMessage(event: { origin: string; source: unknown; data: unknown }, frameWindow: unknown): FrameState | null {
  if (!frameWindow || event.origin !== WADE_ORIGIN || event.source !== frameWindow) return null;
  try {
    return isStateMessage(event.data) ? event.data.state : null;
  } catch {
    return null; // A hostile object whose getters throw is just ignored.
  }
}

/** Sends the disconnect command to the frame only, addressed to Wade's exact origin. */
export function sendDisconnect(frameWindow: { postMessage(message: unknown, targetOrigin: string): void } | null | undefined) {
  if (!frameWindow) return false;
  try {
    frameWindow.postMessage({ ...DISCONNECT_COMMAND }, WADE_ORIGIN);
    return true;
  } catch {
    return false; // the frame may already be gone
  }
}

/** Waits for Wade's answer to a disconnect: confirmed, refused, or no answer in time. */
export function disconnectOutcome(answer: FrameState | null | "timeout"): "disconnected" | "disconnect-unconfirmed" {
  return answer === "disconnected" ? "disconnected" : "disconnect-unconfirmed";
}

/** What the page tells you for each state. Honest about what's connected. */
export const STATE_TEXT: Record<WadeState, string> = {
  off: "Wade runs on your Mac. Show it here to use the same Wade, with the same chats, files and approvals.",
  connecting: "Connecting to Wade on this Mac…",
  ready: "Wade is connected on this Mac. Everything you do here happens inside Wade, under Wade's own approvals.",
  "needs-connection": "Wade needs your OK to work in Maverick. Approve it in the Wade app, then come back.",
  unavailable: "Wade isn't answering on this Mac. Open the Wade app, or use a Mac where Wade is running.",
  disconnecting: "Asking Wade to sign Maverick out…",
  disconnected: "Wade confirmed Maverick is signed out. Showing Wade here again will need your OK in the Wade app.",
  "disconnect-unconfirmed": "Wade didn't confirm the sign-out, so Maverick may still be paired. Remove Maverick in the Wade app to be sure.",
};
