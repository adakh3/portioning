"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Wordmark from "./Wordmark";
import ProductScreens from "./ProductScreens";
import DemoModal from "./DemoModal";

/**
 * The channel band under the hero. Meta (Instagram + Facebook) is the newest
 * capture surface — lead-ad forms ship today (REL-507), DMs follow (REL-508/509).
 */
const CHANNELS = ["Instagram", "Facebook", "WhatsApp", "Email", "Web"];

/**
 * The four sections. These describe the agent doing a job, not a funnel stage
 * being passed through — the page's whole claim is that the software works the
 * lead rather than reporting on it (REL-412's positioning).
 *
 * Section 03 leans on the evidence ladder (REL-516 web trends, REL-517 own
 * win/loss history, REL-518 cross-org aggregates), which is the furthest-ahead
 * claim on the page. Section 04's tracing/evals line is real today (REL-511).
 */
const SECTIONS = [
  {
    n: "01",
    title: "It works the lead, not just the inbox",
    body:
      "Inquiries arrive as Instagram DMs, Facebook lead forms, WhatsApp messages, web forms and " +
      "email. The agent reads each one, extracts the date, guest count, service style and budget, " +
      "creates the lead, routes it to the right rep, and drafts the first reply. Nothing arrives " +
      "unqualified. Nothing sits unworked.",
  },
  {
    n: "02",
    title: "It builds the quote that wins",
    body:
      "Your rep opens a quote and works it with the agent. Ask for a cheaper version and it proposes " +
      "the dish swaps and shows the new per-head. Ask what the margin is and it computes food cost " +
      "against your recipes. Ask it to go more upscale and it rewrites in your brand voice. The agent " +
      "proposes, the rep decides, the quote updates.",
  },
  {
    n: "03",
    title: "It knows what wins",
    body:
      "Judgment, not guesswork. The agent reasons from what's converting in your market, from your " +
      "own win-loss record, and from real pricing in your catalog. When the evidence is thin it says " +
      "so, instead of inventing a pattern out of three events.",
  },
  {
    n: "04",
    title: "You approve everything that leaves the building",
    body:
      "Every message the agent writes waits for approval. It does not send on its own. Every price, " +
      "cost and margin is computed by the pricing engine. The model reads numbers, it never invents " +
      "them. Your menus, pricing and clients are visible to your team only. Every agent run is traced " +
      "and every prompt change is gated by evals.",
  },
];

/** Public marketing landing shown at "/" to logged-out visitors (REL-482). */
export default function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const openDemo = () => setDemoOpen(true);

  return (
    <div className="min-h-screen bg-white text-[#17130F] antialiased">
      <header className="mx-auto flex max-w-[1120px] items-center gap-7 px-6 pt-7 md:px-10">
        <Wordmark />
        <div className="ml-auto flex items-center gap-4 sm:gap-5">
          <Link href="/login" className="text-sm text-[#6B6259] transition-colors hover:text-[#17130F]">
            Sign in
          </Link>
          <button
            type="button"
            onClick={openDemo}
            className="inline-flex h-[38px] items-center whitespace-nowrap rounded-full bg-[#17130F] px-[18px] text-sm font-medium text-white transition-colors hover:bg-[#A9421F]"
          >
            Book a Demo
          </button>
        </div>
      </header>

      <section className="px-6 pt-14 md:px-10 md:pt-[72px]">
        <div className="mx-auto grid max-w-[1120px] items-end gap-10 md:grid-cols-[1.15fr_0.85fr] md:gap-[72px]">
          <h1 className="font-display text-balance text-5xl font-normal leading-[0.98] tracking-[-0.02em] sm:text-6xl lg:text-[86px] lg:leading-[0.96]">
            The <em className="italic text-[#A9421F]">AI sales agent</em> for catering.
          </h1>
          <div>
            <p className="text-pretty text-lg leading-relaxed text-[#574E45]">
              Relogue works every lead from first inquiry to signed contract. It qualifies what comes
              in, builds the quote, argues the pricing, and chases the close. All of it grounded in
              your menus, your costs and your win record.
            </p>
            <button
              type="button"
              onClick={openDemo}
              className="mt-6 inline-flex h-12 items-center whitespace-nowrap rounded-full bg-[#A9421F] px-[26px] text-[15px] font-medium text-white transition-colors hover:bg-[#8B3417]"
            >
              Book a Demo
            </button>
          </div>
        </div>
      </section>

      <section className="px-6 pt-10 md:px-10 md:pt-12">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-3 gap-y-2 border-y border-[#E6E1D9] py-4 text-sm text-[#6B6259]">
          {CHANNELS.map((channel, i) => (
            <span key={channel} className="flex items-center gap-3">
              {i > 0 && <span aria-hidden="true" className="text-[#D5CFC4]">·</span>}
              <span className="font-medium text-[#17130F]">{channel}</span>
            </span>
          ))}
          {/* Pushed right so it reads as its own statement. With the em dash gone there is
              nothing else separating it from the last channel name. Wraps below on mobile. */}
          <span className="text-[#6B6259] sm:ml-auto">Every inquiry, one pipeline.</span>
        </div>
      </section>

      <section className="px-6 pt-12 md:px-10">
        <div className="mx-auto max-w-[1120px]">
          <div className="relative h-[260px] overflow-hidden rounded bg-[#F4F1EB] sm:h-[340px] md:h-[420px]">
            <Image
              src="/landing/hero.jpg"
              alt="A chef garnishing plated dishes at a wedding service"
              fill
              priority
              sizes="(max-width: 1200px) 100vw, 1120px"
              className="object-cover"
            />
          </div>
          <p className="font-display mt-3 text-[15px] italic text-[#6B6259]">
            Plated service at a tent wedding.
          </p>
        </div>
      </section>

      <section className="px-6 pt-20 md:px-10 md:pt-[88px]">
        <div className="mx-auto max-w-[1120px]">
          <h2 className="font-display text-4xl font-normal leading-[1.02] tracking-[-0.02em] sm:text-[52px]">
            See the agent work the lead.
          </h2>
          <div className="mt-8">
            <ProductScreens />
          </div>
        </div>
      </section>

      <section className="px-6 pt-20 md:px-10 md:pt-[88px]">
        <div className="mx-auto max-w-[1120px] border-t border-[#E6E1D9]">
          {SECTIONS.map((section) => (
            <div
              key={section.n}
              className="grid items-start gap-4 border-b border-[#E6E1D9] py-9 md:grid-cols-[90px_1fr_1fr] md:gap-11"
            >
              <span className="font-display text-[54px] italic leading-[0.8] text-[#D5CFC4]">{section.n}</span>
              <h3 className="font-display m-0 text-[28px] font-normal leading-[1.12]">{section.title}</h3>
              <p className="text-pretty m-0 text-base leading-relaxed text-[#574E45]">{section.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-6 pb-12 pt-20 md:px-10">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-6 border-t border-[#E6E1D9] pt-6 text-[13px] text-[#6B6259]">
          <span>© 2026 Relogue Catering</span>
          <button type="button" onClick={openDemo} className="text-[13px] text-[#A9421F] hover:text-[#7E3016]">
            Book a Demo
          </button>
        </div>
      </footer>

      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
