import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { SESSION_COOKIE, rememberedUntil, setupSession, totpSecret, totpUri, validSession } from "@/lib/auth";
import { SetupForm } from "./SetupForm";
import { RememberDevice } from "./RememberDevice";

export const metadata: Metadata = { title: "Sign-in & this device" };

// Shows the authenticator QR code. Reachable only from a device that's already
// signed in, so the password alone is never enough to add an authenticator.
export default function SecurityPage() {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-md px-6 py-12"><p role="status">Loading sign-in settings…</p></main>}>
      <Setup />
    </Suspense>
  );
}

async function Setup() {
  // Expiry must be checked for the current request, never in the static shell.
  await connection();
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!setupSession(cookie)) redirect("/login");
  const done = validSession(cookie);
  const qr = await QRCode.toString(totpUri(), { type: "svg", margin: 1, width: 220 });
  const secret = totpSecret().replace(/(.{4})/g, "$1 ").trim();

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-brand">
        ← Home
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Sign-in &amp; this device</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {done ? "Choose how long this browser or installed app stays signed in." : "Use the current Maverick code from your authenticator app. If you've already added Maverick, you don't need to scan the code again."}
      </p>
      {done ? (
        <p className="mt-6 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          You are signed in on this browser or app.
        </p>
      ) : (
        <p className="mt-6 rounded-lg bg-ember/10 px-3 py-2 text-sm text-brand">
          One-time setup: scan this code with your authenticator app, then type the 6-digit code it shows.
        </p>
      )}
      {done && <RememberDevice initialUntil={rememberedUntil(cookie)} />}
      <details open={!done} className="mt-6">
        {done && <summary className="cursor-pointer text-sm underline">Add the authenticator on another phone</summary>}
        <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div className="rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
          <a href={totpUri()} className="text-sm underline hover:text-brand">
            On this phone? Tap to add it to your authenticator app
          </a>
          <p className="text-center text-xs text-zinc-500">
            Or enter this key by hand: <span className="font-mono text-zinc-700 dark:text-zinc-300">{secret}</span>
          </p>
        </div>
      </details>
      {!done && <SetupForm />}
    </main>
  );
}
