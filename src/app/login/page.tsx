import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <Image src="/maverick-logo.png" alt="Maverick logo" width={72} height={72} className="rounded-2xl" priority />
        <h1 className="text-2xl font-semibold tracking-tight">Maverick Personal</h1>
        <p className="text-sm text-zinc-500">Private. Sign in to continue.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
      <a href="/trust" className="mt-8 text-center text-xs text-zinc-500 hover:text-brand">
        Privacy &amp; Security
      </a>
    </main>
  );
}
