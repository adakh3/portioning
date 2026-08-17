import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Integration test for the AI proposal smart form: it starts a run, renders the
// agent's questions pre-filled with suggestions, and on submit resumes with the
// exact answers object and hands back the drafted quote id.
const h = vi.hoisted(() => ({
  draftProposal: vi.fn(),
  answerProposal: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { draftProposal: h.draftProposal, answerProposal: h.answerProposal },
}));

import { ProposalFormModal } from "./ProposalFormModal";

const QUESTIONS = [
  { id: "headcount", text: "How many guests?", kind: "number", suggested: 100, impact: "high" },
  { id: "service_style", text: "Service style?", kind: "choice", options: ["buffet", "plated"], suggested: "buffet", impact: "low" },
];

beforeEach(() => {
  h.draftProposal.mockReset();
  h.answerProposal.mockReset();
});

describe("ProposalFormModal", () => {
  it("prefills suggestions and submits the edited answers, then hands back the quote id", async () => {
    h.draftProposal.mockResolvedValue({ id: 5, status: "questions_pending", questions: QUESTIONS });
    h.answerProposal.mockResolvedValue({ id: 5, status: "drafted", quote_id: 42 });
    const onDrafted = vi.fn();

    render(<ProposalFormModal leadId={1} onClose={vi.fn()} onDrafted={onDrafted} />);

    // Questions render, headcount prefilled from the suggestion.
    const headcount = await screen.findByDisplayValue("100");
    expect(headcount).toBeTruthy();

    // Change the service style away from the suggested value.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "plated" } });
    fireEvent.click(screen.getByRole("button", { name: /draft proposal/i }));

    await waitFor(() => expect(h.answerProposal).toHaveBeenCalledTimes(1));
    expect(h.answerProposal).toHaveBeenCalledWith(5, { headcount: "100", service_style: "plated" });
    await waitFor(() => expect(onDrafted).toHaveBeenCalledWith(42));
  });

  it("surfaces an error when the draft fails and does not navigate", async () => {
    h.draftProposal.mockResolvedValue({ id: 5, status: "questions_pending", questions: QUESTIONS });
    h.answerProposal.mockResolvedValue({ id: 5, status: "failed", quote_id: null, error: "no catalog dishes" });
    const onDrafted = vi.fn();

    render(<ProposalFormModal leadId={1} onClose={vi.fn()} onDrafted={onDrafted} />);
    await screen.findByDisplayValue("100");
    fireEvent.click(screen.getByRole("button", { name: /draft proposal/i }));

    await waitFor(() => expect(screen.getByText(/no catalog dishes/i)).toBeTruthy());
    expect(onDrafted).not.toHaveBeenCalled();
  });
});
