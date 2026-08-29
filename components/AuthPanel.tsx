"use client";

import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";
import { useState, type FormEvent } from "react";

export function AuthPanel() {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const configured = isSupabaseConfigured();

  async function demo() {
    await fetch("/api/demo", { method: "POST" });
    window.location.href = "/matrix";
  }

  async function magic(e: FormEvent) {
    e.preventDefault();
    if (!configured) return;
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setNotice(error ? error.message : "Check your email for the sign-in link.");
  }

  async function google() {
    if (!configured) return;
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => void demo()}
        className="w-full rounded-xl bg-[var(--accent)] px-4 py-3 text-white"
      >
        Continue in demo mode
      </button>
      {configured ? (
        <>
          <button type="button" onClick={() => void google()} className="w-full rounded-xl border border-[var(--line)] px-4 py-3">
            Continue with Google
          </button>
          <form onSubmit={(e) => void magic(e)} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@family.com"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2"
            />
            <button className="w-full rounded-xl border border-[var(--line)] px-4 py-2 text-sm">
              Email magic link
            </button>
          </form>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Add Supabase keys to enable Google and magic-link for family accounts. Demo mode works now.
        </p>
      )}
      {notice ? <p className="text-sm">{notice}</p> : null}
    </div>
  );
}
