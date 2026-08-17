import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ regenerateProposal: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { regenerateProposal: h.regenerateProposal } }));

import { ProposalPanel } from "./ProposalPanel";
import type { Quote } from "@/lib/api";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    proposal_prose: {
      intro: "Thanks for the opportunity.",
      section_descriptions: { Mains: "Hearty mains." },
      whats_included: ["Menu", "Service"],
      day_of_outline: "Setup then service.",
      closing: "We would love to cater this.",
    },
    proposal_assumptions: [{ field: "service_style", value: "buffet", reason: "none stated" }],
    proposal_draft_id: 9,
    sent_at: null,
    ...overrides,
  } as unknown as Quote;
}

beforeEach(() => h.regenerateProposal.mockReset());

describe("ProposalPanel", () => {
  it("renders prose sections and assumptions", () => {
    render(<ProposalPanel quote={quote()} onRegenerated={vi.fn()} />);
    expect(screen.getByText(/Thanks for the opportunity/)).toBeTruthy();
    expect(screen.getByText(/none stated/)).toBeTruthy();
    expect(screen.getByText(/Hearty mains/)).toBeTruthy();
  });

  it("regenerates and hands back the new quote id (before first send)", async () => {
    h.regenerateProposal.mockResolvedValue({ id: 2, status: "drafted", quote_id: 77 });
    const onRegenerated = vi.fn();
    render(<ProposalPanel quote={quote()} onRegenerated={onRegenerated} />);

    fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
    await waitFor(() => expect(h.regenerateProposal).toHaveBeenCalledWith(9));
    await waitFor(() => expect(onRegenerated).toHaveBeenCalledWith(77));
  });

  it("hides Regenerate once the quote has been sent", () => {
    render(<ProposalPanel quote={quote({ sent_at: "2026-08-17T00:00:00Z" })} onRegenerated={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  it("renders nothing for a hand-built quote", () => {
    const { container } = render(
      <ProposalPanel quote={quote({ proposal_prose: null, proposal_assumptions: null })} onRegenerated={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
