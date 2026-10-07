import { APP_NAME, APP_TAGLINE, LIFE_AREAS } from "@/config/app";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">{APP_TAGLINE}</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIFE_AREAS.map((area) => (
          <div
            key={area.slug}
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <h2 className="font-medium">{area.label}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {area.blurb}
            </p>
            <p className="mt-3 text-xs uppercase tracking-wide text-zinc-400">
              Coming soon
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
