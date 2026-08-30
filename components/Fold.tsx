"use client";

import { useState, type ReactNode } from "react";

export function Fold({
  title,
  children,
  titleClassName = "text-[var(--muted)]",
}: {
  title: string;
  children: ReactNode;
  titleClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className={`flex w-full items-center gap-2 text-left text-xs ${titleClassName}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--line)] text-[10px] leading-none"
          aria-hidden
        >
          {open ? "−" : "+"}
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? <div className="mt-1 pl-6 text-xs leading-relaxed text-[var(--muted)]">{children}</div> : null}
    </div>
  );
}
