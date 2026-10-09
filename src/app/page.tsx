import Image from "next/image";
import Link from "next/link";
import { APP_NAME, APP_TAGLINE, LIFE_AREAS } from "@/config/app";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <header className="mb-10 flex items-center gap-5">
        <Image
          src="/maverick-logo.png"
          alt="Maverick logo"
          width={88}
          height={88}
          priority
          className="rounded-2xl"
        />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">{APP_TAGLINE}</p>
        </div>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIFE_AREAS.map((area) => {
          const body = (
            <>
              <h2 className="font-medium">{area.label}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {area.blurb}
              </p>
              <p className="mt-3 text-xs uppercase tracking-wide text-zinc-400">
                {area.href ? <span className="text-brand">Open →</span> : "Coming soon"}
              </p>
            </>
          );
          const cardClass =
            "rounded-xl border border-zinc-200 p-5 dark:border-zinc-800";
          return area.href ? (
            <Link
              key={area.slug}
              href={area.href}
              className={`${cardClass} transition-colors hover:border-ember`}
            >
              {body}
            </Link>
          ) : (
            <div key={area.slug} className={cardClass}>
              {body}
            </div>
          );
        })}
      </section>
      <footer className="mt-12 text-sm text-zinc-500">
        <Link href="/trust" className="hover:text-brand">
          Privacy &amp; Security
        </Link>
      </footer>
    </main>
  );
}
