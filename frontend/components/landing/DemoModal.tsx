"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

const INPUT =
  "h-10 rounded-md border border-[#D5CFC4] bg-white px-3 text-sm text-[#17130F] outline-none " +
  "focus:border-[#A9421F] focus:ring-2 focus:ring-[#A9421F]/20";

/** Book-a-Demo modal for the public landing + sign-in pages (REL-482). */
export default function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState("");
  // Honeypot: humans never see this field, so anything in it came from a bot.
  // Named to look like nothing a password manager wants to autofill — a field
  // called "website" gets filled with the current URL for real people.
  const [referralSource, setReferralSource] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Closing clears everything, so the next open starts on a fresh form. Without
  // this the modal is one-shot per page load: anyone who submits and then spots
  // a typo reopens onto the old success screen with no way back to the fields.
  useEffect(() => {
    if (open) return;
    setName("");
    setEmail("");
    setEvents("");
    setReferralSource("");
    setError("");
    setSent(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError("Please give your name and a valid work email.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await api.createDemoRequest({
        name: trimmedName,
        email: trimmedEmail,
        events_per_month: events.trim(),
        referral_source: referralSource,
      });
      setSent(true);
    } catch (err) {
      // The API layer already sanitises these into something safe to show, and
      // the specifics matter: "too long" and "you've been throttled" are both
      // actionable, where a fixed "something went wrong" just loses the lead.
      const detail = err instanceof Error ? err.message.trim() : "";
      setError(detail || "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Book a demo"
        className="w-full max-w-[440px] rounded-lg bg-white p-[30px] text-[#17130F] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-[32px] font-normal leading-[1.05]">Book a demo</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-xl leading-none text-[#6B6259] hover:text-[#17130F]"
          >
            ×
          </button>
        </div>

        {sent ? (
          <div>
            <p className="mt-2.5 text-sm leading-relaxed text-[#574E45]">
              Request received — we&apos;ll be in touch to set up your demo.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full bg-[#A9421F] px-5 text-sm font-medium text-white hover:bg-[#8B3417]"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <p className="mt-2.5 text-sm leading-relaxed text-[#574E45]">
              Bring a real menu and a real guest count. We&apos;ll build the quote and the kitchen
              sheet live, in about twenty minutes.
            </p>

            {error && (
              <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3.5 py-2.5 text-[13px] text-red-800">
                {error}
              </div>
            )}

            <div className="mt-5 grid gap-3.5">
              <input
                ref={nameRef}
                type="text"
                aria-label="Your name"
                placeholder="Your name"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={INPUT}
              />
              <input
                type="email"
                aria-label="Work email"
                placeholder="Work email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT}
              />
              <input
                type="text"
                aria-label="Events per month"
                placeholder="Events per month"
                maxLength={100}
                value={events}
                onChange={(e) => setEvents(e.target.value)}
                className={INPUT}
              />
              <input
                type="text"
                name="referral_source"
                value={referralSource}
                onChange={(e) => setReferralSource(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className="absolute -left-[9999px] h-px w-px overflow-hidden"
              />
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full border border-[#D5CFC4] bg-white px-[18px] text-sm text-[#17130F] hover:bg-[#F4F1EB]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="h-10 rounded-full bg-[#A9421F] px-5 text-sm font-medium text-white hover:bg-[#8B3417] disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Request Demo"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
