import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/api", () => ({ api: { createDemoRequest: vi.fn() } }));
// next/image needs the Next server context for priority/fill handling — a plain
// img is enough to assert presence.
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, priority, ...props }: Record<string, unknown>) => <img alt="" {...props} />,
}));

import LandingPage from "./LandingPage";

describe("LandingPage (REL-482)", () => {
  it("renders the hero, product section and footer (AC1)", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The AI sales agent for catering.",
    );
    expect(screen.getByText("See the agent work the lead.")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Relogue Catering")).toBeInTheDocument();
  });

  it("leads with the agent, not with AI as a feature footnote", () => {
    const { container } = render(<LandingPage />);
    // The old page sold a CRM and mentioned AI only in subordinate clauses
    // ("with AI drafting the follow-ups"). The positioning is now that the
    // software works the lead rather than reporting on it, so the h1 itself
    // must carry the claim.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/AI sales agent/);
    expect(container.textContent).not.toMatch(/Quote fast\. ?Win more/);
    expect(container.textContent).toMatch(
      /works every lead from first inquiry to signed contract/,
    );
  });

  it("names every capture channel in the band under the hero", () => {
    render(<LandingPage />);
    // Meta is the newest surface and the reason the band exists — a channel
    // silently dropped from the list is a regression in the pitch.
    for (const channel of ["Instagram", "Facebook", "WhatsApp", "Email", "Web"]) {
      expect(screen.getByText(channel)).toBeInTheDocument();
    }
    expect(screen.getByText("Every inquiry, one pipeline.")).toBeInTheDocument();
  });

  it("renders the four agent sections in order", () => {
    render(<LandingPage />);
    const titles = [
      "It works the lead, not just the inbox",
      "It builds the quote that wins",
      "It knows what wins",
      "You approve everything that leaves the building",
    ];
    for (const title of titles) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    const rendered = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(rendered).toEqual(titles);
  });

  it("makes the human-approval and grounded-numbers promises explicitly", () => {
    const { container } = render(<LandingPage />);
    // These are the answer to the only objection every caterer has, and they
    // are load-bearing claims about how the system actually works (nothing
    // auto-sends; money comes from the pricing engine, never the model). If
    // this copy is ever softened it should be a deliberate decision.
    expect(container.textContent).toMatch(
      /waits for approval\. It does not send on its own/,
    );
    expect(container.textContent).toMatch(
      /computed by the pricing engine\. The model reads numbers, it never invents them/,
    );
  });

  it("has no pricing nav or content (AC6)", () => {
    const { container } = render(<LandingPage />);
    expect(screen.queryByRole("link", { name: /pricing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pricing/i })).not.toBeInTheDocument();
    // No plan cards, tiers or per-period pricing anywhere. Checked against the
    // rendered text rather than a keyword list, so a differently-worded pricing
    // section ("$99 per site", "Starter / Pro") can't slip through.
    expect(container.textContent).not.toMatch(
      /\/ ?month|per month|billed (yearly|monthly)|Most popular|Starter|Enterprise/i,
    );
  });

  it("uses US English throughout — the design came from a UK prototype (US-first market)", () => {
    const { container } = render(<LandingPage />);
    expect(container.textContent).not.toMatch(/enquir/i);
    expect(container.textContent).not.toMatch(/marquee|aubergine|jewelled/i);
    expect(container.textContent).toMatch(/Inquiries/);
  });

  it("links Sign in to /login (AC4)", () => {
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("renders the hero photo with its caption (AC7)", () => {
    render(<LandingPage />);
    const img = screen.getByAltText("A chef garnishing plated dishes at a wedding service");
    expect(img).toHaveAttribute("src", "/landing/hero.jpg");
    expect(screen.getByText("Plated service at a tent wedding.")).toBeInTheDocument();
  });

  it("opens the demo modal from every Book a Demo button (AC4)", () => {
    render(<LandingPage />);
    const buttons = screen.getAllByRole("button", { name: /book a demo/i });
    // Header, hero and footer each carry the CTA — each must open the modal.
    expect(buttons.length).toBe(3);
    for (const button of buttons) {
      fireEvent.click(button);
      expect(screen.getByRole("dialog", { name: "Book a demo" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
  });

  it("switches between the product screens (AC5)", () => {
    render(<LandingPage />);
    // Leads kanban is the default screen.
    expect(screen.getByText("Negotiating")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quote Builder" }));
    expect(screen.getByText("Save Quote")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sales Copilot" }));
    expect(screen.getByText("Proposed change")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI Drafting" }));
    expect(screen.getByText("Message History")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI Lead Triage" }));
    expect(screen.getByText("Lead filled by AI")).toBeInTheDocument();
  });

  it("shows the copilot proposing rather than applying, with honest margin", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sales Copilot" }));
    // Propose-then-confirm is the product's safety model (REL-514 AC2/AC3), so
    // the screenshot must show the confirm step and not a fait accompli.
    expect(screen.getByText("Apply to quote")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing changes on the quote until you apply it."),
    ).toBeInTheDocument();
    // Food margin only; blended is unknown while add-ons carry no cost data.
    // A mock that quietly invents a blended number would misrepresent the tool.
    expect(screen.getByText(/There's no cost data on your add-ons\./)).toBeInTheDocument();
  });

  it("keeps the copilot's arithmetic consistent with the quote builder screen", () => {
    render(<LandingPage />);
    // 180 covers at $130.00 = $23,400.00 on the Quote Builder screen; the
    // proposal lands at $112.00 = $20,160.00. Caterers check this kind of math,
    // and numbers that don't add up cost more trust than they save.
    fireEvent.click(screen.getByRole("button", { name: "Sales Copilot" }));
    expect(screen.getByText("$130.00")).toBeInTheDocument();
    expect(screen.getByText("$112.00")).toBeInTheDocument();
    expect(screen.getByText("$23,400.00")).toBeInTheDocument();
    expect(screen.getByText("$20,160.00")).toBeInTheDocument();
    expect(112 * 180).toBe(20160);
  });


  it("keeps em dashes and semicolons out of the marketing copy on every tab", () => {
    // House style for this page: no em dashes, no semicolons. They are the
    // punctuation people read as machine-written, which is a bad look on a page
    // whose whole claim is that the AI writes to your clients well. Checked on
    // every tab because the product screens carry copy too — including
    // DRAFT_BODY, which is the sample of what our own AI sends a client.
    const { container } = render(<LandingPage />);
    const tabs = ["Leads", "Quote Builder", "Sales Copilot", "AI Drafting", "AI Lead Triage"];
    for (const tab of tabs) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      expect(container.textContent, `em dash on the ${tab} tab`).not.toMatch(/\u2014/);
      expect(container.textContent, `semicolon on the ${tab} tab`).not.toMatch(/;/);
    }
  });

  it("does not mention portioning anywhere — it is hidden until launch", () => {
    const { container } = render(<LandingPage />);
    // Leading \b on each term matters: without it "gram" matches the tail of
    // "Instagram" in the channel band and this guard fires on a false positive.
    expect(container.textContent).not.toMatch(/\bportion|\bgrams?\b|per person.*\bg\b/i);
    expect(screen.queryByRole("button", { name: "Portioning" })).not.toBeInTheDocument();
  });
});
