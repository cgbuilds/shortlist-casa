import type { ReactNode } from "react";
import Link from "next/link";

export function AppShell({
  email,
  children,
}: {
  email?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--paper)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/search" className="font-[family-name:var(--font-display)] text-lg tracking-tight">
            Homestead Matrix
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/matrix" className="hover:underline">
              Matrix
            </Link>
            <Link href="/search" className="hover:underline">
              Grade homes
            </Link>
            {email ? <span className="hidden text-[var(--muted)] sm:inline">{email}</span> : null}
            <form action="/api/logout" method="post">
              <button type="submit" className="text-[var(--muted)] hover:text-[var(--ink)]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-relaxed text-[var(--muted)]">
        Not MLS. Scores are estimates from your matrix and available facts, not an appraisal or financial
        advice. Listing photos and live inventory live on Zillow and Redfin — we only link out.
      </footer>
    </div>
  );
}
