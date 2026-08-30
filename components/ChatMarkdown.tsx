"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";

export function ChatMarkdown({ children, invert }: { children: string; invert?: boolean }) {
  return (
    <div className={invert ? "chat-md chat-md-invert text-sm" : "chat-md text-sm"}>
      <Markdown
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          h1: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
          h2: ({ children }) => <p className="mb-2 font-semibold">{children}</p>,
          h3: ({ children }) => <p className="mb-1 font-semibold">{children}</p>,
          code: ({ children }) => (
            <code className="rounded bg-black/10 px-1 py-0.5 text-[0.85em]">{children}</code>
          ),
          a: ({ href, children }) => (
            <a href={href} className="underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

const CHAT_BUSY = [
  "Accepting the request, working really hard…",
  "Noodling on the must-haves…",
  "Reticulating floor plans…",
  "Walking the block in my head…",
  "Counting porches, not FLOPs…",
  "Sniffing out a café within a short walk…",
  "Herding the dimension knobs…",
  "Chewing on that constraint…",
  "Combing the drainage, not the model card…",
  "Lining up beds, baths, and budget…",
  "Pondering whether we even need another search…",
  "Polishing the grade curve…",
  "Asking the catalog, not the void…",
  "Grazing through the matrix…",
  "Considering a slightly tighter price cap…",
];

function pickBusy(exclude?: string) {
  const pool = exclude ? CHAT_BUSY.filter((line) => line !== exclude) : CHAT_BUSY;
  return pool[Math.floor(Math.random() * pool.length)] ?? CHAT_BUSY[0];
}

export function ChatStatus() {
  const [copy, setCopy] = useState(() => pickBusy());
  useEffect(() => {
    const tick = () => setCopy((prev) => pickBusy(prev));
    const id = window.setInterval(tick, 1600);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="mr-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
      <p className="font-medium text-[var(--ink)]">{copy}</p>
    </div>
  );
}
