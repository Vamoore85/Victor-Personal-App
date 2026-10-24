import Image from "next/image";
import Link from "next/link";
import { APP_TAGLINE, AREA_GROUPS, LIFE_AREAS } from "@/config/app";
import { Icon } from "@/components/icons";
import { SignOut } from "@/components/SignOut";
import { Greeting } from "./Greeting";

const live = LIFE_AREAS.filter((a) => a.href);
const soon = LIFE_AREAS.filter((a) => !a.href);

function AreaCard({ href, slug, label, blurb }: { href: string; slug: string; label: string; blurb: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col items-start gap-2 rounded-xl border border-zinc-200 bg-surface p-3 transition-colors hover:border-ember sm:flex-row sm:gap-3 dark:border-zinc-800"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon name={slug} />
      </span>
      <span className="w-full min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{label}</span>
          <Icon name="chevron" width={14} height={14} className="ml-auto hidden shrink-0 text-zinc-400 group-hover:text-brand sm:block" />
        </span>
        <span className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{blurb}</span>
      </span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-6">
      <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
        <header className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-surface p-3 sm:p-4 dark:border-zinc-800">
          <Image
            src="/brand/maverick-black-horse-logo.png"
            alt="Maverick logo, a black horse"
            width={112}
            height={112}
            priority
            className="h-12 w-12 shrink-0 rounded-full bg-white object-contain ring-1 ring-zinc-200 sm:h-14 sm:w-14 dark:ring-zinc-700"
          />
          <div className="min-w-0">
            <Greeting />
            <p className="truncate text-sm text-zinc-500">{APP_TAGLINE}</p>
          </div>
        </header>

        {AREA_GROUPS.map((g) => (
          <section key={g.id} aria-labelledby={`group-${g.id}`}>
            <h2 id={`group-${g.id}`} className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {g.label}
            </h2>
            <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
              {live
                .filter((a) => a.group === g.id)
                .map((a) => (
                  <AreaCard key={a.slug} href={a.href!} slug={a.slug} label={a.label} blurb={a.blurb} />
                ))}
            </div>
          </section>
        ))}

        <section aria-labelledby="group-soon" className="xl:hidden">
          <h2 id="group-soon" className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Coming soon
          </h2>
          <div className="flex flex-wrap gap-2">
            {soon.map((a) => (
              <span
                key={a.slug}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-surface px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800"
              >
                <Icon name={a.slug} width={14} height={14} />
                {a.label}
              </span>
            ))}
          </div>
        </section>
      </div>

      {/* Desktop: side panel with what's next and account shortcuts */}
      <aside className="hidden flex-col gap-4 xl:flex">
        <section className="rounded-xl border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-medium">Coming soon</h2>
          <ul className="flex flex-col gap-2.5">
            {soon.map((a) => (
              <li key={a.slug} className="flex items-start gap-2.5 text-sm">
                <Icon name={a.slug} className="mt-0.5 shrink-0 text-zinc-400" width={16} height={16} />
                <span className="min-w-0">
                  <span className="block">{a.label}</span>
                  <span className="block text-xs text-zinc-500">{a.blurb}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-zinc-200 bg-surface p-4 text-sm dark:border-zinc-800">
          <h2 className="mb-3 font-medium">Account</h2>
          <div className="flex flex-col gap-2 text-zinc-600 dark:text-zinc-400">
            <Link href="/security" className="hover:text-brand">
              2-step sign-in
            </Link>
            <Link href="/trust" className="hover:text-brand">
              Privacy &amp; Security
            </Link>
            <SignOut className="text-left hover:text-brand" />
          </div>
        </section>
      </aside>
    </div>
  );
}
