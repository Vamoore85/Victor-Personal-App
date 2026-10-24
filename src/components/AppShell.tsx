"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { APP_NAME, AREA_GROUPS, LIFE_AREAS } from "@/config/app";
import { Icon } from "./icons";
import { SignOut } from "./SignOut";

/*
 * The app frame around every signed-in screen.
 *  - Desktop (lg+): fixed left navigation, wide content column.
 *  - Tablet (md–lg): compact top bar with a menu panel.
 *  - Phone (<md): compact top bar plus a fixed bottom tab bar; "More" opens
 *    the full navigation as a sheet.
 * Sign-in, 2-step setup and the public privacy page render without it.
 */

const BARE = ["/login", "/security", "/trust"];

/** Phone tab bar: the screens used most. Everything else is under More. */
const TABS = ["money", "invest", "health"];

const live = LIFE_AREAS.filter((a) => a.href);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function Avatar({ size = 28 }: { size?: number }) {
  return (
    <Image
      src="/maverick-black-beauty.webp"
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover object-[50%_25%]"
      style={{ width: size, height: size }}
    />
  );
}

function NavItem({ href, icon, label, active, onNavigate }: { href: string; icon: string; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm ${
        active
          ? "bg-brand/10 font-medium text-brand"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800/70"
      }`}
    >
      <Icon name={icon} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** The full list of places to go, shared by the desktop sidebar and the phone/tablet menu. */
function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const soon = LIFE_AREAS.filter((a) => !a.href);
  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      <NavItem href="/" icon="home" label="Home" active={isActive(pathname, "/")} onNavigate={onNavigate} />
      {AREA_GROUPS.map((g) => (
        <div key={g.id} className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">{g.label}</p>
          {live
            .filter((a) => a.group === g.id)
            .map((a) => (
              <NavItem key={a.slug} href={a.href!} icon={a.slug} label={a.label} active={isActive(pathname, a.href!)} onNavigate={onNavigate} />
            ))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">Coming soon</p>
        {soon.map((a) => (
          <div key={a.slug} className="flex h-9 items-center gap-3 px-2.5 text-sm text-zinc-400 dark:text-zinc-600">
            <Icon name={a.slug} className="shrink-0" />
            <span className="truncate">{a.label}</span>
          </div>
        ))}
      </div>
    </nav>
  );
}

function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
  const row = "flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70";
  return (
    <div className="flex flex-col gap-0.5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <Link href="/security" onClick={onNavigate} className={row}>
        <Icon name="key" /> 2-step sign-in
      </Link>
      <Link href="/trust" onClick={onNavigate} className={row}>
        <Icon name="shield" /> Privacy &amp; Security
      </Link>
      <SignOut className={`${row} w-full text-left`}>
        <Icon name="logout" /> Sign out
      </SignOut>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  if (BARE.some((p) => isActive(pathname, p))) return <>{children}</>;

  const current = live.find((a) => isActive(pathname, a.href!));
  const close = () => setMenuOpen(false);
  const tabs = live.filter((a) => TABS.includes(a.slug));
  const moreActive = !isActive(pathname, "/") && !tabs.some((a) => isActive(pathname, a.href!));

  return (
    <div className="flex min-h-dvh flex-col lg:pl-64">
      {/* Desktop: persistent left navigation */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-4 overflow-y-auto border-r border-zinc-200 bg-surface px-3 py-4 lg:flex dark:border-zinc-800">
        <Link href="/" className="flex items-center gap-2.5 px-1.5">
          <Avatar size={34} />
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </Link>
        <div className="flex-1">
          <NavList pathname={pathname} />
        </div>
        <AccountLinks />
      </aside>

      {/* Phone and tablet: compact top bar */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2.5 border-b border-zinc-200 bg-surface/95 px-4 backdrop-blur lg:hidden dark:border-zinc-800">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${APP_NAME} home`}>
          <Avatar size={28} />
          <span className="truncate font-semibold tracking-tight">{current ? current.label : APP_NAME}</span>
        </Link>
        <button
          className="ml-auto hidden h-9 w-9 items-center justify-center rounded-full bg-zinc-100 md:inline-flex dark:bg-zinc-800"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" />
        </button>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-3 pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-4 md:pb-8 lg:px-8 lg:pt-6">
        {children}
      </main>

      {/* Phone: fixed bottom tab bar */}
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-200 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-zinc-800"
      >
        {[{ href: "/", slug: "home", short: "Home" }, ...tabs.map((a) => ({ href: a.href!, slug: a.slug, short: a.short }))].map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.slug}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${active ? "font-medium text-brand" : "text-zinc-500"}`}
            >
              <Icon name={t.slug} />
              {t.short}
            </Link>
          );
        })}
        <button
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
          className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${moreActive ? "font-medium text-brand" : "text-zinc-500"}`}
        >
          <Icon name="more" />
          More
        </button>
      </nav>

      {/* Phone and tablet: full navigation as a sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={close} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface px-3 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-80 md:rounded-none md:pb-4">
            <div className="flex items-center gap-2.5 px-1.5">
              <Avatar size={30} />
              <span className="font-semibold tracking-tight">{APP_NAME}</span>
              <button className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800" aria-label="Close menu" onClick={close}>
                <Icon name="close" />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={close} />
            <AccountLinks onNavigate={close} />
          </div>
        </div>
      )}
    </div>
  );
}
