"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, UserMatrix } from "@/lib/types";
import { ChatMarkdown, ChatStatus } from "@/components/ChatMarkdown";

const CHAT_STORAGE_KEY = "homestead-chat-messages";

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "You’re looking at a starter Tampa list (3 bed, 2 bath, single-family). Tell me what to change — area, beds, budget, walkable, flood — and I’ll update the list and scores.",
  },
];

function emitChatLog(event: string, detail: Record<string, unknown>) {
  const payload = { t: new Date().toISOString(), event, ...detail };
  console.info("[homestead-chat]", payload);
}

function readStoredMessages(): ChatMessage[] | null {
  try {
    const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function ChatPanel({
  matrix,
  onMatrix,
  remaining,
  userLimit = 3,
  scoreProgress,
}: {
  matrix: UserMatrix;
  onMatrix: (m: UserMatrix, committed: boolean, extra?: { livePull?: boolean; liveSearch?: boolean }) => void;
  remaining?: number;
  userLimit?: number;
  scoreProgress?: { analyzed: number; total: number; processing: number } | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
  const [hydrated, setHydrated] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = readStoredMessages();
    if (stored) setMessages(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, error]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages, hydrated]);

  async function send() {
    const next = text.trim();
    if (!next || pending) return;
    setText("");
    const history = [...messages, { role: "user" as const, content: next }];
    setMessages(history);
    setPending(true);
    setError(null);
    emitChatLog("request", { chars: next.length });
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, text: next, draft: matrix }),
      });
      const data = await res.json();
      emitChatLog("response", {
        ok: res.ok,
        provider: data.provider,
        model: data.model,
        label: data.label,
        usedModel: data.usedModel,
        toolRounds: data.toolRounds ?? 0,
        elapsedMs: data.elapsedMs,
        commit: Boolean(data.commit),
        livePull: Boolean(data.livePull),
        liveSearch: Boolean(data.liveSearch),
        error: data.error ?? null,
      });
      if (data.error) setError(data.error);
      setMessages([...history, { role: "assistant", content: data.reply ?? "Updated." }]);
      if (data.matrix) {
        onMatrix(data.matrix, Boolean(data.commit), {
          livePull: Boolean(data.livePull),
          liveSearch: Boolean(data.liveSearch),
        });
      }
      if (data.commit) setCommitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "network error";
      emitChatLog("error", { message });
      setError(`Request failed: ${message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-transparent">
      <div className="border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
        {remaining != null ? (
          <>
            Live searches{" "}
            <span className="text-[var(--ink)]">
              {Math.max(0, userLimit - remaining)}/{userLimit}
            </span>
          </>
        ) : (
          <>Live searches {userLimit}/user</>
        )}
        {scoreProgress && scoreProgress.total > 0 ? (
          <>
            {" · "}
            <span className="text-[var(--ink)]">
              {scoreProgress.analyzed}/{scoreProgress.total} scored
            </span>
            {scoreProgress.processing > 0 ? `, ${scoreProgress.processing} processing…` : ""}
          </>
        ) : null}
      </div>
      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-2xl bg-[var(--ink)] px-3 py-2 text-[var(--paper)]"
                : "mr-8 rounded-2xl bg-[var(--paper)] px-3 py-2"
            }
          >
            <ChatMarkdown invert={m.role === "user"}>{m.content}</ChatMarkdown>
          </div>
        ))}
        {pending ? <ChatStatus /> : null}
        {error && !pending ? <p className="text-xs text-[var(--muted)]">{error}</p> : null}
        {committed ? (
          <p className="text-xs text-[var(--accent)]">
            Must-haves saved. The map and list will rescore.
          </p>
        ) : null}
      </div>
      <form
        className="flex gap-2 border-t border-[var(--line)] p-3"
        suppressHydrationWarning
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          suppressHydrationWarning
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            if (!pending) void send();
          }}
          placeholder="Tampa, FL · 3 bed · 2 bath · SFR. Enter to send · Shift+Enter for a new line"
          rows={3}
          className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50" type="submit" disabled={pending}>
          {pending ? "On it…" : "Send"}
        </button>
      </form>
    </div>
  );
}
