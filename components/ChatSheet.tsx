"use client";

import { useEffect, type ReactNode } from "react";

export function ChatSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex overflow-hidden sm:items-center sm:justify-end sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]"
        aria-label="Close chat"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="AI assist"
        className="relative z-10 flex h-full max-h-full w-full min-h-0 flex-col overflow-hidden border-[var(--line)] bg-[var(--paper-2)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl sm:h-[min(36rem,calc(100svh-3rem))] sm:max-h-[calc(100svh-3rem)] sm:w-[26rem] sm:rounded-2xl sm:border sm:pt-0"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <p className="text-sm font-medium">AI assist</p>
          <button type="button" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

export function ChatFab({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open chat"
      title="Chat"
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg hover:opacity-95 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
