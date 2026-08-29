"use client";

import { useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { MatrixPreview } from "@/components/MatrixPreview";
import { RedfinUpload } from "@/components/RedfinUpload";
import type { UserMatrix } from "@/lib/types";

export function MatrixClient({ initial }: { initial: UserMatrix }) {
  const [matrix, setMatrix] = useState(initial);
  const [saved, setSaved] = useState(false);

  async function commitNow() {
    await fetch("/api/matrix", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matrix }),
    });
    setSaved(true);
  }

  return (
    <div className="space-y-8">
      <RedfinUpload
        autoFocus={saved}
        heading={
          saved
            ? "Matrix locked — upload a Redfin CSV to grade it"
            : "When the matrix looks right, upload a Redfin CSV"
        }
      />
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl">Build your matrix</h1>
          <p className="mt-2 mb-4 max-w-xl text-sm text-[var(--muted)]">
            Paste free text (Mom’s gates, your own). When you say yes / commit, an upload box appears at the
            top so you don’t have to hunt for it.
          </p>
          <ChatPanel
            matrix={matrix}
            onMatrix={(m, committed) => {
              setMatrix(m);
              if (committed) {
                setSaved(true);
                window.requestAnimationFrame(() => {
                  document.getElementById("upload-csv")?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }
            }}
          />
          <button className="mt-3 text-sm underline" type="button" onClick={() => void commitNow()}>
            Commit without chat
          </button>
          {saved ? <span className="ml-3 text-sm text-[var(--accent)]">Saved</span> : null}
        </div>
        <MatrixPreview matrix={matrix} />
      </div>
    </div>
  );
}
