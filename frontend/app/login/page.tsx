"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import DemoModal from "@/components/landing/DemoModal";

const INPUT =
  "h-10 w-full rounded-md border border-[#D5CFC4] bg-white px-3 text-sm text-[#17130F] outline-none " +
  "focus:border-[#A9421F] focus:ring-2 focus:ring-[#A9421F]/20";

export default function LoginPage() {
  const { login } = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const returnTo = searchParams.get("returnTo") || undefined;
      await login(email, password, returnTo);
    } catch (err) {
      // Show what the server said when it said something specific. A wrong
      // password is still "Invalid email or password", but a locked-out account
      // now answers 429 with the reason and the fact that waiting fixes it —
      // rewriting that as a credentials error tells someone to keep retrying
      // the thing that is locking them out (REL-485).
      const detail = err instanceof Error ? err.message.trim() : "";
      setError(detail || "Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="font-display text-[44px] font-normal leading-[1.04] tracking-[-0.02em]">Sign in</h1>
      <p className="mt-3 text-sm leading-relaxed text-[#6B6259]">
        Use the email address your admin set up. Ask them for an invite if you don&apos;t have one
        yet.
      </p>

      {error && (
        <div className="mt-5 rounded-md border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
        <label className="grid gap-[7px]">
          <span className="text-[13px] font-medium">Email</span>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="you@yourkitchen.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </label>

        <label className="grid gap-[7px]">
          <span className="text-[13px] font-medium">Password</span>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="mt-1.5 h-11 rounded-full bg-[#A9421F] text-[15px] font-medium text-white transition-colors hover:bg-[#8B3417] disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-[13px] text-[#6B6259]">
        No account yet?{" "}
        <button
          type="button"
          onClick={() => setDemoOpen(true)}
          className="text-[13px] text-[#A9421F] hover:text-[#7E3016]"
        >
          Book a demo
        </button>
      </p>

      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
