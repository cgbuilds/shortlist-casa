"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/chat";
import type { UserMatrix } from "@/lib/types";

export function ChatPanel({
  matrix,
  onMatrix,
}: {
  matrix: UserMatrix;
  onMatrix: (m: UserMatrix, committed: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "We’ll build a grader from the catalog — not a blank spreadsheet. Start with must-haves: beds, baths, and minimum living area.",
    },
  ]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);

  async function send() {
    const next = text.trim();
    if (!next || pending) return;
    setText("");
    const history = [...messages, { role: "user" as const, content: next }];
    setMessages(history);
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, text: next, draft: matrix }),
      });
      const data = await res.json();
      setMessages([...history, { role: "assistant", content: data.reply ?? "Updated." }]);
      if (data.matrix) onMatrix(data.matrix, Boolean(data.commit));
      if (data.commit) setCommitted(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[min(70vh,640px)] flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-2)]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-2xl bg-[var(--ink)] px-3 py-2 text-sm text-[var(--paper)]"
                : "mr-8 rounded-2xl bg-[var(--paper)] px-3 py-2 text-sm"
            }
          >
            {m.content}
          </div>
        ))}
        {pending ? <p className="text-xs text-[var(--muted)]">Thinking…</p> : null}
        {committed ? (
          <p className="text-xs text-[var(--accent)]">Active matrix saved. Search will use this grader.</p>
        ) : null}
      </div>
      <form
        className="flex gap-2 border-t border-[var(--line)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. 4 bed, 2500 sf min, block, Bloomingdale HS, $525k cap"
          className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white" type="submit">
          Send
        </button>
      </form>
    </div>
  );
}
