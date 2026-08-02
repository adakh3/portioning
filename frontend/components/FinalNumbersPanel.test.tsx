import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({ data: [{ id: 1, name: "Beef" }, { id: 2, name: "Salmon" }, { id: 3, name: "Cake" }] }),
}));

const recordEventFinals = vi.fn();
vi.mock("@/lib/api", () => ({ api: { recordEventFinals: (...a: unknown[]) => recordEventFinals(...a) } }));

import FinalNumbersPanel from "./FinalNumbersPanel";
import type { EventData } from "@/lib/api";

function makeEvent(over: Partial<EventData> = {}): EventData {
  return {
    id: 7,
    guaranteed_count: null,
    final_count: null,
    final_count_due: "2026-08-20",
    finals_status: "due_soon",
    entree_choices: { "1": null, "2": null },
    ...over,
  } as EventData;
}

function open(event: EventData = makeEvent(), onSaved = vi.fn()) {
  render(<FinalNumbersPanel event={event} dateFormat="MM/DD/YYYY" onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Record final numbers"));
  return onSaved;
}

beforeEach(() => {
  recordEventFinals.mockReset();
  recordEventFinals.mockResolvedValue({});
});

describe("FinalNumbersPanel", () => {
  it("shows the derived pill alongside the panel", () => {  // AC4
    render(<FinalNumbersPanel event={makeEvent()} dateFormat="MM/DD/YYYY" onSaved={vi.fn()} />);
    expect(screen.getByTestId("finals-pill")).toHaveTextContent("Finals due 08/20/2026");
  });

  it("records the guarantee, the due date and every tally in ONE save", async () => {  // AC6
    const onSaved = open();
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Guaranteed count"), { target: { value: "140" } });
    fireEvent.change(screen.getByLabelText("Final count due"), { target: { value: "2026-08-18" } });
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Tally for Salmon"), { target: { value: "60" } });

    fireEvent.click(screen.getByText("Save final numbers"));

    await waitFor(() => expect(recordEventFinals).toHaveBeenCalledTimes(1));
    expect(recordEventFinals).toHaveBeenCalledWith(7, {
      final_count: 150,
      final_count_due: "2026-08-18",
      guaranteed_count: 140,
      entree_counts: { "1": 90, "2": 60 },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("blocks the save with a live message until the tallies add up", () => {  // AC7
    open();
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Tally for Salmon"), { target: { value: "55" } });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Entrée choices must add up to the final guarantee (150) — they currently total 145.",
    );
    expect(screen.getByText("Save final numbers")).toBeDisabled();

    fireEvent.click(screen.getByText("Save final numbers"));
    expect(recordEventFinals).not.toHaveBeenCalled();

    // Correct it → the message clears and the save unlocks.
    fireEvent.change(screen.getByLabelText("Tally for Salmon"), { target: { value: "60" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Save final numbers")).not.toBeDisabled();
  });

  it("never asks for a sum when no entrée choices are offered", () => {  // AC7 scope
    open(makeEvent({ entree_choices: {} }));
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "150" } });
    expect(screen.queryByLabelText(/Tally for/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Save final numbers")).not.toBeDisabled();
  });

  it("cannot be saved before a guarantee is typed", () => {
    open();
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });

  it("pre-fills what was already recorded so a correction is a one-field edit", () => {  // AC11
    open(makeEvent({
      final_count: 150, guaranteed_count: 140, finals_status: "recorded",
      entree_choices: { "1": 90, "2": 60 },
    }));
    expect(screen.getByLabelText("Final guarantee")).toHaveValue(150);
    expect(screen.getByLabelText("Tally for Beef")).toHaveValue(90);
    expect(screen.getByLabelText("Tally for Salmon")).toHaveValue(60);
  });

  it("summarises the recorded numbers when closed", () => {  // AC6
    render(
      <FinalNumbersPanel
        event={makeEvent({
          final_count: 150, guaranteed_count: 140, finals_status: "recorded",
          entree_choices: { "1": 90, "2": 60 },
        })}
        dateFormat="MM/DD/YYYY"
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByTestId("finals-pill")).toHaveTextContent("Finals recorded");
    expect(screen.getByText("Beef")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });

  it("surfaces a backend rejection instead of pretending it saved", async () => {
    recordEventFinals.mockRejectedValue(new Error("Entrée choices must add up"));
    const onSaved = open();
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "150" } });
    fireEvent.click(screen.getByText("Save final numbers"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Entrée choices must add up"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("re-seeds when a dish stops being offered, instead of summing a stale tally", () => {
    // The panel outlives an edit of the menu above it. Counts seeded once at mount
    // kept summing the removed dish, so the panel said 50/50 while the save sent 30
    // — and the backend rejected what the panel had just green-lit.
    const view = render(
      <FinalNumbersPanel event={makeEvent()} dateFormat="MM/DD/YYYY" onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Record final numbers"));
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Tally for Salmon"), { target: { value: "20" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Salmon is un-offered in the editor above; the event refetches.
    view.rerender(
      <FinalNumbersPanel
        event={makeEvent({ entree_choices: { "1": null } })}
        dateFormat="MM/DD/YYYY"
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Tally for Salmon")).not.toBeInTheDocument();
    expect(screen.getByText("Total entered: 30")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("currently total 30");
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });

  it("keeps a typed tally when an extra dish is offered mid-edit", () => {
    const view = render(
      <FinalNumbersPanel
        event={makeEvent({ entree_choices: { "1": null } })}
        dateFormat="MM/DD/YYYY"
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Record final numbers"));
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "30" } });
    view.rerender(
      <FinalNumbersPanel event={makeEvent()} dateFormat="MM/DD/YYYY" onSaved={vi.fn()} />,
    );
    expect(screen.getByLabelText("Tally for Beef")).toHaveValue(30);
    expect(screen.getByLabelText("Tally for Salmon")).toHaveValue(null);
  });

  it("refuses a negative tally that would otherwise 'add up'", () => {
    open();
    fireEvent.change(screen.getByLabelText("Final guarantee"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Tally for Beef"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Tally for Salmon"), { target: { value: "-10" } });
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be negative");
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });
});