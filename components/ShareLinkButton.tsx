"use client";

import { useState } from "react";
import type { PropertyListing, UserMatrix } from "@/lib/types";
import { encodeShare, shareUrlFromToken } from "@/lib/share";

export function ShareLinkButton({
  matrix,
  listings,
}: {
  matrix: UserMatrix;
  listings: PropertyListing[];
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "err">("idle");

  if (!listings.length) return null;

  async function copy() {
    try {
      const token = await encodeShare(matrix, listings);
      const url = shareUrlFromToken(token);
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      if (mobile && typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: "Shortlist",
            text: "Here’s our scored shortlist.",
            url,
          });
          setStatus("copied");
          window.setTimeout(() => setStatus("idle"), 2000);
          return;
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("err");
      window.setTimeout(() => setStatus("idle"), 2500);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 text-xs font-medium text-[var(--accent)]"
    >
      {status === "copied" ? "Copied" : status === "err" ? "Couldn’t copy" : "Copy link"}
    </button>
  );
}
