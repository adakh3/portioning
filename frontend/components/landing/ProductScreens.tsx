"use client";

import { useState } from "react";

/**
 * The tabbed product-screen mock on the landing page (REL-482, from the
 * RelogueLanding v3 design). Everything here is static illustration — the
 * screens deliberately keep the app's own cool neutrals while the page
 * around them uses the warm marketing palette.
 */

type TabId = "leads" | "eventform" | "portioning" | "drafting" | "triage";

const TABS: { id: TabId; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "eventform", label: "Event Form" },
  { id: "portioning", label: "Portioning" },
  { id: "drafting", label: "AI Drafting" },
  { id: "triage", label: "AI Lead Triage" },
];

const SCREEN_HEADERS: Record<TabId, { title: string; meta: string }> = {
  leads: { title: "Leads", meta: "Kanban · 6 statuses" },
  eventform: { title: "New Event", meta: "Okonjo–Adeyemi Wedding · draft" },
  portioning: { title: "Portioning", meta: "180 guests · 90 gents / 90 ladies · 6 dishes" },
  drafting: { title: "Send to Client", meta: "Quote v2 · $24,120.00" },
  triage: { title: "Lead Triage", meta: "1 new enquiry · WhatsApp" },
};

const KANBAN_COLUMNS = [
  {
    name: "New", count: 12, headClass: "bg-[hsl(221_83%_53%)]",
    cards: [
      { name: "Nadia Okonjo", meta: "Wedding · 14 Mar 2026", guests: "180 guests", product: "Fine Dining", initials: "MR" },
      { name: "Halcyon Group", meta: "Corporate lunch · 02 Apr 2026", guests: "90 guests", product: "Corporate", initials: "AH" },
    ],
  },
  {
    name: "Contacted", count: 9, headClass: "bg-[hsl(189_94%_43%)]",
    cards: [{ name: "Fern & Fig Ltd", meta: "Product launch · 19 Apr 2026", guests: "240 guests", product: "Corporate", initials: "PN" }],
  },
  {
    name: "Menu sent", count: 6, headClass: "bg-[hsl(258_90%_66%)]",
    cards: [{ name: "Ridgeway School", meta: "Gala dinner · 09 May 2026", guests: "320 guests", product: "Fine Dining", initials: "AH" }],
  },
  {
    name: "Negotiating", count: 5, headClass: "bg-[hsl(38_92%_50%)]",
    cards: [{ name: "Aurora Weddings", meta: "Wedding · 06 Jun 2026", guests: "260 guests", product: "Fine Dining", initials: "MR" }],
  },
];

const PORTION_ROWS: ({ group: string } | { name: string; yours: number; rec: number })[] = [
  { group: "Starters" },
  { name: "Grilled halloumi skewers", yours: 60, rec: 60 },
  { name: "Smoked aubergine dip", yours: 40, rec: 45 },
  { group: "Mains" },
  { name: "Saffron chicken thigh", yours: 170, rec: 180 },
  { name: "Slow-braised short rib", yours: 210, rec: 200 },
  { group: "Sides" },
  { name: "Herbed jewelled rice", yours: 140, rec: 140 },
];

const FORM_FIELDS = [
  { label: "Event Name", value: "Okonjo–Adeyemi Wedding", full: true },
  { label: "Customer", value: "Nadia Okonjo" },
  { label: "Venue", value: "Thornbury Hall" },
  { label: "Event Date", value: "14 Mar 2026" },
  { label: "Service Style", value: "Plated" },
  { label: "Gents", value: "90" },
  { label: "Ladies", value: "90" },
];

const MENU_LINES = [
  { name: "Grilled halloumi skewers", course: "Starter", price: "$1,080.00" },
  { name: "Saffron chicken thigh", course: "Main", price: "$8,640.00" },
  { name: "Slow-braised short rib", course: "Main", price: "$10,800.00" },
  { name: "Herbed jewelled rice", course: "Side", price: "$2,160.00" },
];

const SUMMARY_ROWS = [
  { label: "Guests", value: "180" },
  { label: "Food per person", value: "622g" },
  { label: "Service charge (10%)", value: "$2,193.00" },
  { label: "Total", value: "$24,120.00" },
];

const LEDGER = [
  { channel: "Email", when: "Today, 09:14", text: "Quote v2 sent · opened twice", pill: "bg-[hsl(221_83%_53%/.15)] text-[hsl(221_83%_40%)]" },
  { channel: "WhatsApp", when: "Yesterday, 18:02", text: "Nadia: can we swap the dessert?", pill: "bg-[hsl(142_71%_45%/.15)] text-[hsl(142_71%_26%)]" },
  { channel: "Email", when: "12 Feb", text: "Tasting confirmation · delivered", pill: "bg-[hsl(221_83%_53%/.15)] text-[hsl(221_83%_40%)]" },
  { channel: "System", when: "10 Feb", text: "Lead created from web enquiry", pill: "bg-[hsl(215_16%_47%/.15)] text-[hsl(215_20%_32%)]" },
];

const EXTRACTED = [
  { label: "Customer", value: "Nadia Okonjo" },
  { label: "Event type", value: "Wedding" },
  { label: "Date", value: "14 Mar 2026" },
  { label: "Guests", value: "180 · 90 / 90" },
  { label: "Service style", value: "Plated" },
  { label: "Dietary", value: "No pork · Vegetarian" },
  { label: "Budget", value: "$25,000" },
];

const DRAFT_BODY =
  "Hi Nadia — the quote for 14 March is attached: plated service for 180, with the halloumi " +
  "skewers and short rib you liked at the tasting. It holds until 28 February. Sign on the " +
  "link and we'll lock the date.";

const ENQUIRY_TEXT =
  "Hi! We're getting married at Thornbury Hall on 14 March next year, about 180 guests, half " +
  "and half. Looking for plated service, no pork, a few vegetarians. Budget is around 25k. " +
  "Can you send a menu?";

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

function PortioningScreen() {
  return (
    <div className="overflow-x-auto p-5">
      <div className="mb-4 rounded-md border border-[hsl(142_71%_45%/.2)] bg-[hsl(142_71%_45%/.1)] px-3.5 py-2.5 text-[13px] text-[hsl(142_71%_24%)]">
        All clear — your portions are within all constraints.
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[hsl(0_0%_89.8%)] bg-[hsl(0_0%_96.1%)]">
            <th className="px-3 py-2 text-left text-[13px] font-medium text-[hsl(0_0%_25%)]">Dish</th>
            <th className="w-32 px-3 py-2 text-right text-[13px] font-medium text-[hsl(0_0%_25%)]">Your Portion</th>
            <th className="w-28 px-3 py-2 text-right text-[13px] font-medium text-[hsl(0_0%_25%)]">Engine Rec</th>
            <th className="w-[132px] px-3 py-2 text-right text-[13px] font-medium text-[hsl(0_0%_25%)]">Delta</th>
          </tr>
        </thead>
        <tbody>
          {PORTION_ROWS.map((row) =>
            "group" in row ? (
              <tr key={row.group} className="border-t border-[hsl(0_0%_89.8%)] bg-[hsl(0_0%_96.1%)]">
                <td colSpan={4} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[hsl(0_0%_20%)]">
                  {row.group}
                </td>
              </tr>
            ) : (
              <tr key={row.name} className="border-b border-[hsl(0_0%_89.8%)]">
                <td className="py-1.5 pl-6 pr-3 text-sm">{row.name}</td>
                <td className="px-3 py-1.5 text-right text-sm">{row.yours}g</td>
                <td className="px-3 py-1.5 text-right font-mono text-[13px] text-[hsl(0_0%_45%)]">{row.rec}g</td>
                <td
                  className={`px-3 py-1.5 text-right font-mono text-[13px] ${
                    Math.abs(((row.yours - row.rec) / row.rec) * 100) <= 10
                      ? "text-[hsl(142_71%_32%)]"
                      : "text-[hsl(38_92%_30%)]"
                  }`}
                >
                  {row.yours - row.rec > 0 ? "+" : ""}
                  {row.yours - row.rec}g ({row.yours - row.rec > 0 ? "+" : ""}
                  {Math.round(((row.yours - row.rec) / row.rec) * 100)}%)
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[hsl(0_0%_89.8%)] bg-[hsl(0_0%_96.1%)] font-semibold">
            <td className="px-3 py-2.5 text-sm">Food per Person</td>
            <td className="px-3 py-2.5 text-right text-sm">622g</td>
            <td className="px-3 py-2.5 text-right font-mono text-[13px] font-normal text-[hsl(0_0%_45%)]">627g</td>
            <td className="px-3 py-2.5 text-right font-mono text-[13px] font-normal text-[hsl(142_71%_32%)]">-5g</td>
          </tr>
        </tfoot>
      </table>
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
            <span className="tabular-nums">$24,120.00</span>
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
            Save Event
          </span>
          <span className="flex h-[34px] items-center justify-center rounded-md border border-[hsl(0_0%_89.8%)] text-[13px]">
            View Portions
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
          <div className="text-xs text-[hsl(0_0%_45%)]">To — nadia.okonjo@gmail.com · from hello@relogue.co</div>
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
          Incoming enquiry — WhatsApp
        </div>
        <div className="text-[13px] leading-relaxed text-[hsl(0_0%_20%)]">{ENQUIRY_TEXT}</div>
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
  portioning: PortioningScreen,
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
