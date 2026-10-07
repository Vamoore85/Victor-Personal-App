import Image from "next/image";
import Link from "next/link";

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-brand">
        <Image src="/maverick-logo.png" alt="" width={28} height={28} className="rounded-md" />
        Maverick Personal
      </Link>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">{subtitle}</p>
    </header>
  );
}
