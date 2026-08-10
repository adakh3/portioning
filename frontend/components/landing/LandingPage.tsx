"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Wordmark from "./Wordmark";
import ProductScreens from "./ProductScreens";
import DemoModal from "./DemoModal";

const STEPS = [
  {
    n: "01",
    title: "The inquiry lands",
    body: "Inquiries from your website, WhatsApp and inbox arrive on one board with the guest count, date and budget already pulled out.",
  },
  {
    n: "02",
    title: "The quote goes out",
    body: "Build from your menu pricing, send from your own mailbox or WhatsApp, and the client signs on their phone.",
  },
  {
    n: "03",
    title: "The kitchen gets numbers",
    body: "Signing turns the quote into an event: grams per person per dish, prep sheets, equipment and staff.",
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
            From the first inquiry to the <em className="italic text-[#A9421F]">last gram</em>.
          </h1>
          <div>
            <p className="text-pretty text-lg leading-relaxed text-[#574E45]">
              Inquiries, quotes, signatures and grams per guest in one place — with AI drafting the
              messages and sizing the portions.
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
            A lead comes in. The kitchen gets grams.
          </h2>
          <div className="mt-8">
            <ProductScreens />
          </div>
        </div>
      </section>

      <section className="px-6 pt-20 md:px-10 md:pt-[88px]">
        <div className="mx-auto max-w-[1120px] border-t border-[#E6E1D9]">
          {STEPS.map((step) => (
            <div
              key={step.n}
              className="grid items-start gap-4 border-b border-[#E6E1D9] py-9 md:grid-cols-[90px_1fr_1fr] md:gap-11"
            >
              <span className="font-display text-[54px] italic leading-[0.8] text-[#D5CFC4]">{step.n}</span>
              <h3 className="font-display m-0 text-[28px] font-normal leading-[1.12]">{step.title}</h3>
              <p className="text-pretty m-0 text-base leading-relaxed text-[#574E45]">{step.body}</p>
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
