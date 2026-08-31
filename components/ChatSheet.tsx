"use client";

import { useEffect, useRef, type ReactNode } from "react";

function pinToVisualViewport(el: HTMLElement) {
  const vv = window.visualViewport;
  if (!vv) {
    el.style.top = "0px";
    el.style.left = "0px";
    el.style.width = "100%";
    el.style.height = "100%";
    return;
  }
  el.style.top = `${vv.offsetTop}px`;
  el.style.left = `${vv.offsetLeft}px`;
  el.style.width = `${vv.width}px`;
  el.style.height = `${vv.height}px`;
}

export function ChatSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = overlay.current;
    if (!el) return;
    const apply = () => {
      window.scrollTo(0, 0);
      pinToVisualViewport(el);
    };
    apply();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div ref={overlay} className="fixed z-50 flex overflow-hidden sm:items-center sm:justify-end sm:p-6" style={{ inset: 0 }}>
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]"
        aria-label="Close chat"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="AI assist"
        aria-modal="true"
        className="relative z-10 flex h-full max-h-full w-full min-h-0 flex-col overflow-hidden border-[var(--line)] bg-[var(--paper-2)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl sm:h-[min(36rem,calc(100svh-3rem))] sm:max-h-[calc(100svh-3rem)] sm:w-[26rem] sm:rounded-2xl sm:border sm:pt-0"
      >
        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
          <p className="text-base font-medium">AI assist</p>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center rounded-xl bg-[var(--ink)] px-4 text-base font-medium text-[var(--paper)]"
            onClick={onClose}
          >
            Done
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
