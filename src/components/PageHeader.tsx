import type { ReactNode } from "react";

/**
 * Compact screen title inside the app frame. On phones the description is
 * cut to one line so the screen's own content starts right away.
 */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-3 flex items-end justify-between gap-3 lg:mb-5">
      <div className="min-w-0">
        <h1 className="hidden text-2xl font-semibold tracking-tight lg:block">{title}</h1>
        {subtitle && <p className="line-clamp-1 text-sm text-zinc-500 sm:line-clamp-none lg:mt-0.5">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}
