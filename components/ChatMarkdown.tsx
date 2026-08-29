"use client";

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

export function ChatStatus({
  label,
  model,
  phase,
}: {
  label: string;
  model?: string;
  phase: "sending" | "waiting" | "tools";
}) {
  const copy =
    phase === "sending"
      ? `Sending your note to ${label}…`
      : phase === "tools"
        ? `Waiting on ${label} — updating your matrix tools…`
        : `Waiting on a reply from ${label}…`;
  return (
    <div className="mr-8 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs text-[var(--muted)]">
      <p className="font-medium text-[var(--ink)]">{copy}</p>
      {model ? <p className="mt-1">Model: {model}</p> : null}
      <p className="mt-1">This can take a few seconds while the model calls catalog tools.</p>
    </div>
  );
}
