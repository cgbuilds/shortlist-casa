"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

function pinToVisualViewport(el: HTMLElement) {
  const vv = window.visualViewport;
  const width = Math.max(1, Math.round(vv?.width || window.innerWidth || 320));
  // Never size to layout innerHeight — on iPhone that includes the area behind the keyboard.
  const height = Math.max(1, Math.round(vv?.height || window.innerHeight || 320));
  el.style.position = "fixed";
  el.style.top = `${Math.round(vv?.offsetTop ?? 0)}px`;
  el.style.left = `${Math.round(vv?.offsetLeft ?? 0)}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}

export function ChatSheet({
  open,
  onClose,
  onKeyboard,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onKeyboard?: (open: boolean) => void;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setKeyboard(false);
      onKeyboard?.(false);
      return;
    }
    const el = overlay.current;
    if (!el) return;
    const apply = () => {
      window.scrollTo(0, 0);
      pinToVisualViewport(el);
      const vv = window.visualViewport;
      const openKb = Boolean(vv && (window.innerHeight - vv.height > 80 || vv.offsetTop > 20));
      setKeyboard(openKb);
      onKeyboard?.(openKb);
    };
    apply();
    const id = window.setTimeout(apply, 50);
    const later = window.setTimeout(apply, 300);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    window.addEventListener("resize", apply);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(later);
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
    };
  }, [open, onKeyboard]);

  if (!open) return null;

  function closeFromBackdrop() {
    if (Date.now() - openedAt.current < 900) return;
    onClose();
  }

  return (
    <div ref={overlay} className="fixed z-[2000] flex items-end overflow-hidden sm:items-center sm:justify-end sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-[color-mix(in_oklab,var(--ink)_35%,transparent)]"
        aria-label="Close chat"
        onClick={closeFromBackdrop}
      />
      <div
        role="dialog"
        aria-label="Chat"
        aria-modal="true"
        className={`relative z-10 flex w-full min-h-0 flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-[var(--paper-2)] shadow-xl sm:h-[min(36rem,calc(100svh-3rem))] sm:max-h-[calc(100svh-3rem)] sm:w-[26rem] sm:rounded-2xl sm:pt-0 ${
          keyboard ? "h-full max-h-full pt-0" : "h-[92%] max-h-full pt-[env(safe-area-inset-top)]"
        }`}
      >
        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--paper-2)] px-3 py-2">
          <p className="text-base font-medium">Chat</p>
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

export function ChatFab({
  onClick,
  className = "",
  nudge = false,
}: {
  onClick: () => void;
  className?: string;
  nudge?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Tell Chat your must-haves"
      title="Tell Chat your must-haves"
      className={`inline-flex h-12 items-center gap-2 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-white shadow-lg ring-2 ring-white/70 hover:opacity-95 ${nudge ? "chat-bounce" : ""} ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" strokeLinejoin="round" />
      </svg>
      Chat
    </button>
  );
}
