"use client";

import { useState } from "react";

/**
 * The tabbed product-screen mock on the landing page (REL-482, from the
 * RelogueLanding v3 design). Everything here is static illustration — the
 * screens deliberately keep the app's own cool neutrals while the page
 * around them uses the warm marketing palette.
 */

type TabId = "leads" | "eventform" | "drafting" | "triage";

const TABS: { id: TabId; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "eventform", label: "Quote Builder" },
  { id: "drafting", label: "AI Drafting" },
  { id: "triage", label: "AI Lead Triage" },
];

const SCREEN_HEADERS: Record<TabId, { title: string; meta: string }> = {
  leads: { title: "Leads", meta: "Kanban · 6 statuses" },
  eventform: { title: "New Quote", meta: "Harper–Ross Wedding · draft" },
  drafting: { title: "Send to Client", meta: "Quote v2 · $28,080.00" },
  triage: { title: "Lead Triage", meta: "1 new inquiry · WhatsApp" },
};

const KANBAN_COLUMNS = [
  {
    name: "New", count: 12, headClass: "bg-[hsl(221_83%_53%)]",
    cards: [
      { name: "Emily Harper", meta: "Wedding · Mar 14, 2026", guests: "180 guests", product: "Fine Dining", initials: "MR" },
      { name: "Halcyon Group", meta: "Corporate lunch · Apr 2, 2026", guests: "90 guests", product: "Corporate", initials: "AH" },
    ],
  },
  {
    name: "Contacted", count: 9, headClass: "bg-[hsl(189_94%_43%)]",
    cards: [{ name: "Fern & Fig Co.", meta: "Product launch · Apr 19, 2026", guests: "240 guests", product: "Corporate", initials: "PN" }],
  },
  {
    name: "Menu sent", count: 6, headClass: "bg-[hsl(258_90%_66%)]",
    cards: [{ name: "Northside High School", meta: "Gala dinner · May 9, 2026", guests: "320 guests", product: "Fine Dining", initials: "AH" }],
  },
  {
    name: "Negotiating", count: 5, headClass: "bg-[hsl(38_92%_50%)]",
    cards: [{ name: "Aurora Weddings", meta: "Wedding · Jun 6, 2026", guests: "260 guests", product: "Fine Dining", initials: "MR" }],
  },
];

const FORM_FIELDS = [
  { label: "Event Name", value: "Harper–Ross Wedding", full: true },
  { label: "Customer", value: "Emily Harper" },
  { label: "Venue", value: "Cedar Ridge Barn" },
  { label: "Event Date", value: "Mar 14, 2026" },
  { label: "Service Style", value: "Plated" },
  { label: "Adults", value: "150" },
  { label: "Kids", value: "30" },
];

// Deliberately consistent arithmetic: five dishes for 180 guests sum to the
// subtotal, 20% service charge on top gives the total, and the same total
// appears on the Send-to-Client screen. Caterers check the math on a page
// like this, and numbers that don't add up cost more trust than they save.
const MENU_LINES = [
  { name: "Whipped ricotta crostini", course: "Starter", price: "$1,080.00" },
  { name: "Smoked eggplant dip", course: "Starter", price: "$720.00" },
  { name: "Herb-roasted chicken", course: "Main", price: "$8,640.00" },
  { name: "Slow-braised short rib", course: "Main", price: "$10,800.00" },
  { name: "Herbed wild rice", course: "Side", price: "$2,160.00" },
];

const SUMMARY_ROWS = [
  { label: "Guests", value: "180" },
  { label: "Per head", value: "$130.00" },
  { label: "Subtotal", value: "$23,400.00" },
  { label: "Service charge (20%)", value: "$4,680.00" },
  { label: "Total", value: "$28,080.00" },
];

const LEDGER = [
  { channel: "Email", when: "Today, 09:14", text: "Quote v2 sent · opened twice", pill: "bg-[hsl(221_83%_53%/.15)] text-[hsl(221_83%_40%)]" },
  { channel: "WhatsApp", when: "Yesterday, 18:02", text: "Nadia: can we swap the dessert?", pill: "bg-[hsl(142_71%_45%/.15)] text-[hsl(142_71%_26%)]" },
  { channel: "Email", when: "Feb 12", text: "Tasting confirmation · delivered", pill: "bg-[hsl(221_83%_53%/.15)] text-[hsl(221_83%_40%)]" },
  { channel: "System", when: "Feb 10", text: "Lead created from web inquiry", pill: "bg-[hsl(215_16%_47%/.15)] text-[hsl(215_20%_32%)]" },
];

const EXTRACTED = [
  { label: "Customer", value: "Emily Harper" },
  { label: "Event type", value: "Wedding" },
  { label: "Date", value: "Mar 14, 2026" },
  { label: "Guests", value: "180 · 150 adults / 30 kids" },
  { label: "Service style", value: "Plated" },
  { label: "Dietary", value: "Gluten-free · Vegetarian" },
  { label: "Budget", value: "$30,000" },
];

const DRAFT_BODY =
  "Hi Emily — the quote for March 14 is attached: plated service for 180, with the crostini " +
  "and short rib you liked at the tasting. It holds until February 28. Sign on the link and " +
  "we'll lock the date.";

const INQUIRY_TEXT =
  "Hi! We're getting married at Cedar Ridge Barn on March 14 next year, about 180 guests — " +
  "150 adults and 30 kids. Looking for plated service, a couple of gluten-free and vegetarian " +
  "guests. Budget is around 30k. Can you send a menu?";

const PANE_HEAD =
  "border-b border-[hsl(0_0%_89.8%)] bg-[hsl(0_0%_96.1%)] px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-[hsl(0_0%_25%)]";

function LeadsScreen() {
  return (
    <div className="grid grid-cols-1 gap-3 bg-[hsl(0_0%_98%)] p-5 sm:grid-cols-2 lg:grid-cols-4">
      {KANBAN_COLUMNS.map((col) => (
        <div key={col.name} className="overflow-hidden rounded-lg">
          <div className={`flex items-center justify-between px-3 py-2 text-sm font-semibold text-white ${col.headClass}`}>
            <span>{col.name}</span>
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px]">
              {col.count}
            </span>
          </div>
          <div className="grid min-h-[196px] content-start gap-2 bg-[hsl(0_0%_96.1%)] p-2">
            {col.cards.map((card) => (
              <div key={card.name} className="rounded-lg border border-[hsl(0_0%_89.8%)] bg-white p-3">
                <div className="text-[13px] font-medium">{card.name}</div>
                <div className="mt-1 text-[11px] text-[hsl(0_0%_45%)]">{card.meta}</div>
                <div className="mt-0.5 text-[11px] text-[hsl(0_0%_45%)]">{card.guests}</div>
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="rounded bg-[hsl(221_83%_53%/.12)] px-1.5 py-0.5 text-[10px] font-medium text-primary">
                    {card.product}
                  </span>
                  <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[hsl(0_0%_89.8%)] text-[10px] font-semibold text-[hsl(0_0%_30%)]">
                    {card.initials}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventFormScreen() {
  return (
    <div className="grid items-start gap-5 p-5 md:grid-cols-[1.5fr_1fr]">
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FORM_FIELDS.map((f) => (
            <label key={f.label} className={`grid gap-1.5 ${f.full ? "sm:col-span-2" : ""}`}>
              <span className="text-xs font-medium text-[hsl(0_0%_25%)]">{f.label}</span>
              <span className="flex h-9 items-center rounded-md border border-[hsl(0_0%_89.8%)] bg-white px-3 text-sm">
                {f.value}
              </span>
            </label>
          ))}
        </div>
        <div className="overflow-hidden rounded-lg border border-[hsl(0_0%_89.8%)]">
          <div className={`flex items-center justify-between ${PANE_HEAD}`}>
            <span>Menu</span>
            <span className="text-[11px] font-medium normal-case tracking-normal text-primary">+ Add Dish</span>
          </div>
          {MENU_LINES.map((line) => (
            <div key={line.name} className="flex items-center justify-between gap-3 border-b border-[hsl(0_0%_89.8%)] px-3 py-2.5">
              <span className="text-[13px]">{line.name}</span>
              <span className="flex items-center gap-3.5">
                <span className="text-xs text-[hsl(0_0%_45%)]">{line.course}</span>
                <span className="min-w-16 text-right text-[13px] tabular-nums">{line.price}</span>
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-[hsl(0_0%_96.1%)] px-3 py-2.5 text-[13px] font-semibold">
            <span>Total</span>
            <span className="tabular-nums">$23,400.00</span>
          </div>
        </div>
      </div>
      <div className="grid gap-3 rounded-lg border border-[hsl(0_0%_89.8%)] p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[hsl(0_0%_25%)]">Summary</div>
        {SUMMARY_ROWS.map((s) => (
          <div key={s.label} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-[hsl(0_0%_45%)]">{s.label}</span>
            <span className="text-right font-medium">{s.value}</span>
          </div>
        ))}
        <div className="mt-1 grid gap-2">
          <span className="flex h-[34px] items-center justify-center rounded-md bg-[hsl(142_71%_40%)] text-[13px] font-medium text-white">
            Save Quote
          </span>
          <span className="flex h-[34px] items-center justify-center rounded-md border border-[hsl(0_0%_89.8%)] text-[13px]">
            Send to Client
          </span>
        </div>
      </div>
    </div>
  );
}

function DraftingScreen() {
  return (
    <div className="grid items-start gap-5 p-5 md:grid-cols-2">
      <div className="overflow-hidden rounded-lg border border-[hsl(0_0%_89.8%)]">
        <div className={PANE_HEAD}>Send to Client</div>
        <div className="grid gap-3 p-3.5">
          <div className="flex gap-2">
            <span className="inline-flex h-[30px] items-center rounded-md bg-[hsl(221_83%_53%/.12)] px-3 text-[13px] font-medium text-primary">
              Email
            </span>
            <span className="inline-flex h-[30px] items-center rounded-md border border-[hsl(0_0%_89.8%)] px-3 text-[13px] text-[hsl(0_0%_45%)]">
              WhatsApp
            </span>
          </div>
          <div className="text-xs text-[hsl(0_0%_45%)]">To — emily.harper@gmail.com · from hello@relogue.co</div>
          <div className="rounded-md border border-[hsl(0_0%_89.8%)] p-3 text-[13px] leading-relaxed text-[hsl(0_0%_20%)]">
            {DRAFT_BODY}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-primary">Drafted by AI from the quote and your last three messages.</span>
            <span className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">
              Send Quote
            </span>
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-[hsl(0_0%_89.8%)]">
        <div className={PANE_HEAD}>Message History</div>
        {LEDGER.map((m) => (
          <div key={`${m.when}-${m.text}`} className="grid gap-1 border-b border-[hsl(0_0%_89.8%)] p-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${m.pill}`}>
                {m.channel}
              </span>
              <span className="text-xs text-[hsl(0_0%_45%)]">{m.when}</span>
            </div>
            <div className="text-[13px] leading-normal">{m.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TriageScreen() {
  return (
    <div className="grid items-start gap-5 p-5 md:grid-cols-2">
      <div className="rounded-lg border border-[hsl(0_0%_89.8%)] p-3.5">
        <div className="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-[hsl(0_0%_25%)]">
          Incoming inquiry — WhatsApp
        </div>
        <div className="text-[13px] leading-relaxed text-[hsl(0_0%_20%)]">{INQUIRY_TEXT}</div>
      </div>
      <div className="rounded-lg border border-[hsl(0_0%_89.8%)] p-3.5">
        <div className="mb-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-primary">Lead filled by AI</div>
        {EXTRACTED.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-[hsl(0_0%_89.8%)] py-2 text-[13px]"
          >
            <span className="text-[hsl(0_0%_45%)]">{row.label}</span>
            <span className="text-right font-medium">{row.value}</span>
          </div>
        ))}
        <div className="mt-3.5 flex gap-2">
          <span className="inline-flex h-8 items-center rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">
            Create Lead
          </span>
          <span className="inline-flex h-8 items-center rounded-md border border-[hsl(0_0%_89.8%)] px-3.5 text-[13px]">
            Edit Details
          </span>
        </div>
      </div>
    </div>
  );
}

const SCREENS: Record<TabId, () => React.ReactElement> = {
  leads: LeadsScreen,
  eventform: EventFormScreen,
  drafting: DraftingScreen,
  triage: TriageScreen,
};

export default function ProductScreens() {
  const [tab, setTab] = useState<TabId>("leads");
  const Screen = SCREENS[tab];
  const header = SCREEN_HEADERS[tab];

  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-[#E6E1D9]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-4 py-3 text-sm transition-colors sm:px-5 ${
              tab === t.id
                ? "font-semibold text-[#A9421F] shadow-[inset_0_-2px_0_#A9421F]"
                : "font-normal text-[#6B6259] hover:text-[#17130F]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-md border border-[#E6E1D9] bg-white text-[hsl(0_0%_3.9%)] shadow-[0_18px_44px_rgba(23,19,15,.07)]">
        <div className="flex h-[46px] items-center gap-3 border-b border-[hsl(0_0%_89.8%)] bg-[hsl(0_0%_98%)] px-5">
          <span className="text-sm font-semibold">{header.title}</span>
          <span className="truncate text-xs text-[hsl(0_0%_45%)]">{header.meta}</span>
        </div>
        <Screen />
      </div>
    </div>
  );
}
