"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass, ghostButtonClass } from "@/features/money/ui";
import {
  disconnectOutcome,
  readFrameMessage,
  sendDisconnect,
  STATE_TEXT,
  WADE_APP_URL,
  WADE_DISCONNECT_WAIT_MS,
  WADE_FRAME_ALLOW,
  WADE_FRAME_URL,
  WADE_TIMEOUT_MS,
  type FrameState,
  type WadeState,
} from "./protocol";

/**
 * Maverick's sign-out sends this before signing out. A page with an open Wade
 * frame hands back a promise through `detail.waitFor`, and sign-out waits for
 * it (briefly) so Wade can sign Maverick out first.
 */
export const SIGN_OUT_EVENT = "maverick-sign-out";
export type SignOutDetail = { waitFor: (p: Promise<unknown>) => void };

const TONE: Record<WadeState, string> = {
  off: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  connecting: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  disconnecting: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  disconnected: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  "needs-connection": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  unavailable: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  "disconnect-unconfirmed": "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};
const LABEL: Record<WadeState, string> = {
  off: "Not shown",
  connecting: "Connecting",
  ready: "Connected",
  "needs-connection": "Needs your OK",
  unavailable: "Unavailable",
  disconnecting: "Signing out",
  disconnected: "Signed out",
  "disconnect-unconfirmed": "Sign-out not confirmed",
};

export function WadePanel() {
  // `session` changes each time the frame is made, so a closed frame's late messages are ignored.
  const [session, setSession] = useState(0);
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<WadeState>("off");
  const frame = useRef<HTMLIFrameElement | null>(null);
  const awaitingAck = useRef<((s: FrameState | null | "timeout") => void) | null>(null);

  useEffect(() => {
    if (!session) return;
    let heard = false;
    const onMessage = (event: MessageEvent) => {
      const next = readFrameMessage(event, frame.current?.contentWindow);
      if (!next) return;
      heard = true;
      if ((next === "disconnected" || next === "disconnect-unconfirmed") && awaitingAck.current) awaitingAck.current(next);
      else setState(next);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => {
      if (!heard) setState("unavailable");
    }, WADE_TIMEOUT_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [session]);

  /** Asks Wade to sign this embed out, waits briefly for its answer, then closes the frame. */
  const disconnect = useCallback(async () => {
    setState("disconnecting");
    const answer = await new Promise<FrameState | null | "timeout">((resolve) => {
      const timer = window.setTimeout(() => resolve("timeout"), WADE_DISCONNECT_WAIT_MS);
      awaitingAck.current = (s) => {
        window.clearTimeout(timer);
        resolve(s);
      };
      if (!sendDisconnect(frame.current?.contentWindow)) awaitingAck.current(null);
    });
    awaitingAck.current = null;
    setSession(0);
    setShown(false);
    setState(disconnectOutcome(answer));
  }, []);

  // Signing out of Maverick signs Wade's embed out first, if it's open here.
  useEffect(() => {
    const onSignOut = (e: Event) => {
      if (session) (e as CustomEvent<SignOutDetail>).detail?.waitFor(disconnect());
    };
    window.addEventListener(SIGN_OUT_EVENT, onSignOut);
    return () => window.removeEventListener(SIGN_OUT_EVENT, onSignOut);
  }, [session, disconnect]);

  const start = (trusted: boolean) => {
    if (!trusted) return; // only a real click makes the frame
    setState("connecting");
    setSession((s) => s + 1);
    setShown(true);
  };
  const busy = state === "disconnecting";

  return (
    <div className="flex flex-col gap-4" data-testid="wade-panel" data-wade-state={state}>
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="text-lg font-semibold">Wade</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[state]}`} data-testid="wade-state">
              {LABEL[state]}
            </span>
          </p>
          <p className="text-sm text-zinc-500" role="status">
            {STATE_TEXT[state]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!session && (
            <button type="button" className={buttonClass} onClick={(e) => start(e.isTrusted)}>
              Show Wade here
            </button>
          )}
          {session > 0 && (state === "unavailable" || state === "needs-connection") && (
            <button type="button" className={ghostButtonClass} onClick={(e) => start(e.isTrusted)}>
              Try again
            </button>
          )}
          {session > 0 && (
            <button type="button" className={ghostButtonClass} onClick={() => setShown((v) => !v)} aria-expanded={shown} aria-controls="wade-frame-host" disabled={busy}>
              {shown ? "Hide (stays connected)" : "Show"}
            </button>
          )}
          {session > 0 && (
            <button type="button" className={ghostButtonClass} onClick={disconnect} disabled={busy}>
              Disconnect Maverick from Wade
            </button>
          )}
          <a className={ghostButtonClass} href={WADE_APP_URL}>
            Open Wade app
          </a>
        </div>
      </section>

      {session > 0 && (
        <div id="wade-frame-host" hidden={!shown} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <iframe
            key={session}
            ref={frame}
            src={WADE_FRAME_URL}
            title="Wade, private workspace on this Mac"
            referrerPolicy="no-referrer"
            allow={WADE_FRAME_ALLOW}
            className="h-[75vh] min-h-[480px] w-full bg-white"
            onError={() => setState("unavailable")}
          />
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Wade stays its own app on your Mac. Maverick only shows Wade&apos;s window: it never sees Wade&apos;s chats, keys or drafts and keeps no copy. Wade pairs with
        maverick-personal.vercel.app through its own approval, separate from the CRM. Hiding Wade or leaving this page keeps Maverick connected. Disconnect, or signing out of
        Maverick while Wade is open here, asks Wade to sign Maverick out and shows whether Wade confirmed it. You can always remove Maverick in the Wade app.
      </p>
    </div>
  );
}
