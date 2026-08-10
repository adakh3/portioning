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
      "You cook. Let AI do the paperwork.",
    );
    expect(screen.getByText("A lead comes in. The kitchen gets grams.")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Relogue Catering")).toBeInTheDocument();
  });

  it("has no pricing nav or content (AC6)", () => {
    render(<LandingPage />);
    expect(screen.queryByRole("link", { name: "Pricing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pricing" })).not.toBeInTheDocument();
    // No plan cards / dollar-per-month pricing anywhere.
    expect(screen.queryByText(/\/ month|billed yearly|Most popular/)).not.toBeInTheDocument();
  });

  it("links Sign in to /login (AC4)", () => {
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("renders the hero photo with its caption (AC7)", () => {
    render(<LandingPage />);
    const img = screen.getByAltText("A chef garnishing plated dishes at a wedding service");
    expect(img).toHaveAttribute("src", "/landing/hero.jpg");
    expect(screen.getByText("Plated service at a marquee wedding.")).toBeInTheDocument();
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

  it("switches between the five product screens (AC5)", () => {
    render(<LandingPage />);
    // Leads kanban is the default screen.
    expect(screen.getByText("Negotiating")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Event Form" }));
    expect(screen.getByText("Save Event")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Portioning" }));
    expect(screen.getByText("Engine Rec")).toBeInTheDocument();
    expect(screen.getByText("All clear — your portions are within all constraints.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI Drafting" }));
    expect(screen.getByText("Message History")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI Lead Triage" }));
    expect(screen.getByText("Lead filled by AI")).toBeInTheDocument();
  });
});
