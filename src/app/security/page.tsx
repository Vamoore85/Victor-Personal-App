import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { SESSION_COOKIE, setupSession, totpSecret, totpUri, validSession } from "@/lib/auth";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "2-step sign-in" };

// Shows the authenticator QR code. Reachable only from a device that's already
// signed in, so the password alone is never enough to add an authenticator.
export default function SecurityPage() {
  return (
    <Suspense>
      <Setup />
    </Suspense>
  );
}

async function Setup() {
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
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">2-step sign-in</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Signing in takes your password plus a 6-digit code from an authenticator app on your phone, such as Google Authenticator,
        Microsoft Authenticator or 1Password.
      </p>
      {done ? (
        <p className="mt-6 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          2-step sign-in is on for this device. To add the app on another phone, scan the code below with it.
        </p>
      ) : (
        <p className="mt-6 rounded-lg bg-ember/10 px-3 py-2 text-sm text-brand">
          One-time setup: scan this code with your authenticator app, then type the 6-digit code it shows.
        </p>
      )}
      <div className="mt-6 flex flex-col items-center gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="rounded-lg bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
        <a href={totpUri()} className="text-sm underline hover:text-brand">
          On this phone? Tap to add it to your authenticator app
        </a>
        <p className="text-center text-xs text-zinc-500">
          Or enter this key by hand: <span className="font-mono text-zinc-700 dark:text-zinc-300">{secret}</span>
        </p>
      </div>
      {!done && <SetupForm />}
    </main>
  );
}
