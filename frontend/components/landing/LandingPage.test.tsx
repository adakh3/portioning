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
      "Quote fast. Win more.",
    );
    expect(screen.getByText("Every inquiry, quoted and closed.")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Relogue Catering")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "AI Drafting" }));
    expect(screen.getByText("Message History")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI Lead Triage" }));
    expect(screen.getByText("Lead filled by AI")).toBeInTheDocument();
  });

  it("does not mention portioning anywhere — it is hidden until launch", () => {
    const { container } = render(<LandingPage />);
    expect(container.textContent).not.toMatch(/portion|grams?\b|per person.*g\b/i);
    expect(screen.queryByRole("button", { name: "Portioning" })).not.toBeInTheDocument();
  });
});
