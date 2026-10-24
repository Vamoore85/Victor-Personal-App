/*
 * Running Plaid Link (Plaid's sign-in window, drawn as a layer inside this
 * page, not a separate browser window) from start to finish, with every step
 * time-bounded so the button never sits on "connecting" for ever:
 *   1. a link token from this site's server,
 *   2. Plaid's script, loaded and ready,
 *   3. the window, opened once Plaid says it has loaded, and confirmed open by
 *      Plaid's OPEN event.
 * No browser parts are touched directly, so the whole flow is tested in Node
 * with a stand-in Plaid (plaid-link.test.ts).
 */

export type LinkMeta = {
  institution?: { name?: string; institution_id?: string } | null;
  accounts?: { id?: string; mask?: string | null; name?: string; type?: string; subtype?: string | null }[];
};
type LinkError = { display_message?: string | null; error_message?: string | null; error_code?: string | null } | null;
export type PlaidHandler = { open: () => void; destroy: () => void };
export type PlaidFactory = {
  create: (opts: {
    token: string;
    onSuccess: (publicToken: string, meta: LinkMeta) => void;
    onExit: (err: LinkError, meta?: LinkMeta) => void;
    onLoad?: () => void;
    onEvent?: (eventName: string) => void;
  }) => PlaidHandler;
};

/** How far opening the bank's window has got, for the button's label. */
export type LinkStep = "token" | "script" | "starting" | "open" | "finishing";

export type LinkDeps = {
  getToken: () => Promise<string>;
  loadScript: () => Promise<PlaidFactory>;
  onStep?: (s: LinkStep) => void;
  /** Logs where it failed (stage and Plaid's error code only, never account details). */
  report?: (stage: string, code?: string) => void;
  /** How long Plaid has to show its window once the script is ready. */
  openTimeoutMs?: number;
  /** If Plaid never says it has loaded, open anyway after this long. */
  loadFallbackMs?: number;
};

export class LinkFailure extends Error {
  constructor(
    message: string,
    readonly stage: "token" | "script" | "open" | "exit",
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Resolves with the public token and what was picked, or null if you closed the window; rejects with a LinkFailure. */
export async function runLink(deps: LinkDeps): Promise<{ publicToken: string; meta: LinkMeta } | null> {
  const { onStep = () => {}, report = () => {} } = deps;
  const fail = (stage: LinkFailure["stage"], message: string, code?: string) => {
    report(stage, code);
    return new LinkFailure(message, stage, code);
  };

  onStep("token");
  let token: string;
  try {
    token = await deps.getToken();
  } catch (e) {
    const err = e as Error & { code?: string };
    throw fail("token", `Couldn't start the bank connection: ${err.message || "the server didn't answer"}`, err.code);
  }

  onStep("script");
  let plaid: PlaidFactory;
  try {
    plaid = await deps.loadScript();
  } catch (e) {
    throw fail("script", (e as Error).message || "Couldn't load Plaid.", "SCRIPT");
  }

  onStep("starting");
  return new Promise((resolve, reject) => {
    let opened = false;
    let settled = false;
    let openCalled = false;
    let handler: PlaidHandler | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      try {
        handler?.destroy();
      } catch {}
      fn();
    };
    const open = () => {
      if (openCalled || settled || !handler) return;
      openCalled = true;
      try {
        handler.open();
      } catch (e) {
        settle(() => reject(fail("open", `Plaid's window couldn't open: ${(e as Error).message}`, "OPEN_THREW")));
      }
    };
    try {
      handler = plaid.create({
        token,
        onLoad: open,
        onEvent: (name) => {
          if (!opened && (name === "OPEN" || name === "TRANSITION_VIEW" || name === "SELECT_INSTITUTION" || name === "SELECT_ACCOUNT")) {
            opened = true;
            timers.forEach(clearTimeout);
            onStep("open");
          }
        },
        onSuccess: (publicToken, meta) => {
          onStep("finishing");
          settle(() => resolve({ publicToken, meta: meta ?? {} }));
        },
        onExit: (err) => {
          if (!err) return settle(() => resolve(null));
          const reason = err.display_message || err.error_message || "The bank connection didn't finish.";
          settle(() => reject(fail("exit", `Plaid stopped: ${reason}`, err.error_code ?? undefined)));
        },
      });
    } catch (e) {
      settle(() => reject(fail("open", `Plaid couldn't start: ${(e as Error).message}`, "CREATE_THREW")));
      return;
    }
    timers.push(setTimeout(open, deps.loadFallbackMs ?? 4000));
    timers.push(
      setTimeout(() => {
        if (opened) return;
        settle(() => reject(fail("open", `Plaid's window didn't appear within ${Math.round((deps.openTimeoutMs ?? 20000) / 1000)} seconds. Try again.`, "TIMEOUT")));
      }, deps.openTimeoutMs ?? 20000),
    );
  });
}

/**
 * After the window closes: of the accounts you ticked, which one is the account
 * we were reconnecting, and were they all accounts that are already connected?
 */
export function checkPicked(meta: LinkMeta, target: string | undefined, connected: Set<string>) {
  const masks = (meta.accounts ?? []).map((a) => a.mask ?? "").filter(Boolean);
  return {
    masks,
    hasTarget: !!target && masks.includes(target),
    onlyAlreadyConnected: masks.length > 0 && masks.every((m) => connected.has(m)),
  };
}
