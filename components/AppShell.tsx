import type { ReactNode } from "react";
import Link from "next/link";
import { BRAND_NAME } from "@/lib/brand";

export function AppShell({
  email,
  children,
  full,
}: {
  email?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "fixed inset-0 flex min-h-0 flex-col overflow-hidden overscroll-none bg-[var(--paper)]" : "min-h-screen"}>
      <header className="z-20 shrink-0 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--paper)_92%,transparent)]">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/app" className="font-[family-name:var(--font-display)] text-lg tracking-tight">
            {BRAND_NAME}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            {email ? <span className="hidden text-[var(--muted)] sm:inline">{email}</span> : null}
            <form action="/api/logout" method="post" suppressHydrationWarning>
              <button type="submit" className="text-[var(--muted)] hover:text-[var(--ink)]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className={full ? "flex min-h-0 flex-1 flex-col" : "mx-auto max-w-6xl px-4 py-8"}>{children}</main>
      {full ? null : (
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-relaxed text-[var(--muted)]">
          Not MLS. Scores are estimates from your must-haves and available facts, not an appraisal or financial
          advice. Listing photos and live inventory live on Zillow and Redfin — we only link out.
        </footer>
      )}
    </div>
  );
}
