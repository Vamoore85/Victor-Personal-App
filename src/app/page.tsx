import Link from "next/link";
import { LIFE_AREAS } from "@/config/app";
import { Icon } from "@/components/icons";
import { Greeting } from "./Greeting";
import { ScanPanel } from "@/features/receipts/ScanReceipt";

const primary = [
  { slug: "money", short: "Money", label: "Money", blurb: "What you have, what's coming out, and what needs attention", href: "/money" },
  { slug: "accounts", short: "Accounts", label: "Accounts", blurb: "Your accounts and current balances, clearly organized", href: "/accounts" },
  { slug: "reports", short: "Reports", label: "Reports", blurb: "Readable summaries and downloadable financial records", href: "/reports" },
];
export default function Home() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 py-4 sm:py-8">
      <header>
        <Greeting />
        <p className="mt-3 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">Your personal dashboard. Start with what you need today.</p>
      </header>
      <ScanPanel />
      <section className="grid gap-4 sm:grid-cols-3" aria-label="Everyday tools">
        {primary.map((area) => {
          const slug = area.slug;
          return <Link key={slug} href={area.href!} className="group rounded-2xl border border-zinc-200 bg-surface p-6 transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-brand dark:border-zinc-800">
            <Icon name={slug} className="mb-6 text-brand" width={28} height={28} />
            <h2 className="text-xl font-semibold">{area.label}</h2>
            <p className="mt-2 text-base leading-relaxed text-zinc-600 dark:text-zinc-400">{area.blurb}</p>
            <span className="mt-6 block text-sm font-medium text-brand">Open {area.short.toLowerCase()} →</span>
          </Link>;
        })}
      </section>
      <details className="rounded-2xl border border-zinc-200 bg-surface p-5 dark:border-zinc-800">
        <summary className="cursor-pointer text-base font-medium">Everything else</summary>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {LIFE_AREAS.filter((a) => a.href && !primary.some((p) => p.slug === a.slug)).map((a) => <Link key={a.slug} href={a.href!} className="rounded-xl p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <span className="font-medium">{a.label}</span>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">{a.blurb}</p>
          </Link>)}
        </div>
      </details>
    </div>
  );
}
