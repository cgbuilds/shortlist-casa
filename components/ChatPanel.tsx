"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/chat";
import type { UserMatrix } from "@/lib/types";
import { ChatMarkdown, ChatStatus } from "@/components/ChatMarkdown";

type ProviderInfo = { provider: string; model: string; label: string };

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
        "We’ll build a grader from the catalog. Paste a family member’s gates in one note — townhouse, garage, 3 floors or less, 2+ bed/bath, laundry, walkable, flood — then commit and grade the Redfin CSV.",
    },
  ]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"sending" | "waiting" | "tools">("sending");
  const [committed, setCommitted] = useState(false);
  const [provider, setProvider] = useState<ProviderInfo>({
    provider: "heuristic",
    model: "built-in",
    label: "Built-in coach",
  });
  const [lastMeta, setLastMeta] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/chat")
      .then((r) => r.json())
      .then((data: ProviderInfo) => {
        if (data?.label) setProvider(data);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, lastMeta]);

  useEffect(() => {
    if (!pending) return;
    setPhase("sending");
    const t1 = window.setTimeout(() => setPhase("waiting"), 400);
    const t2 = window.setTimeout(() => setPhase("tools"), 2500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [pending]);

  async function send() {
    const next = text.trim();
    if (!next || pending) return;
    setText("");
    const history = [...messages, { role: "user" as const, content: next }];
    setMessages(history);
    setPending(true);
    setLastMeta(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, text: next, draft: matrix }),
      });
      const data = await res.json();
      if (data.label) {
        setProvider({
          provider: data.provider,
          model: data.model ?? provider.model,
          label: data.label,
        });
      }
      const seconds = data.elapsedMs != null ? (data.elapsedMs / 1000).toFixed(1) : null;
      const tools = data.toolRounds ? `${data.toolRounds} tool round${data.toolRounds === 1 ? "" : "s"}` : "no tool calls";
      setLastMeta(
        data.error
          ? `Error: ${data.error}`
          : `Reply from ${data.label ?? provider.label}${seconds ? ` in ${seconds}s` : ""} · ${tools}`
      );
      setMessages([...history, { role: "assistant", content: data.reply ?? "Updated." }]);
      if (data.matrix) onMatrix(data.matrix, Boolean(data.commit));
      if (data.commit) setCommitted(true);
    } catch (err) {
      setLastMeta(`Request failed: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex h-[min(70vh,640px)] flex-col rounded-2xl border border-[var(--line)] bg-[var(--paper-2)]">
      <div className="border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--muted)]">
        Chat provider: <span className="text-[var(--ink)]">{provider.label}</span>
        {provider.model ? ` · ${provider.model}` : ""}
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
        {pending ? <ChatStatus label={provider.label} model={provider.model} phase={phase} /> : null}
        {lastMeta && !pending ? <p className="text-xs text-[var(--muted)]">{lastMeta}</p> : null}
        {committed ? (
          <p className="text-xs text-[var(--accent)]">
            Active matrix saved.{" "}
            <a href="#upload-csv" className="underline">
              Upload a Redfin CSV
            </a>{" "}
            above to grade homes.
          </p>
        ) : null}
      </div>
      <form
        className="flex gap-2 border-t border-[var(--line)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="townhouse w/ garage or 3 floors or less; end unit; 2+ bed; 2+ bath; in-unit W/D; walkable; not high flood risk; long term"
          rows={3}
          className="flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm"
        />
        <button className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50" type="submit" disabled={pending}>
          {pending ? "Waiting…" : "Send"}
        </button>
      </form>
    </div>
  );
}
