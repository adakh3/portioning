import { vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({
    data: [
      { id: 1, name: "Beef" }, { id: 2, name: "Salmon" },
      { id: 3, name: "Brownie" }, { id: 4, name: "Cheesecake" },
    ],
  }),
}));

const recordEventFinals = vi.fn();
vi.mock("@/lib/api", () => ({ api: { recordEventFinals: (...a: unknown[]) => recordEventFinals(...a) } }));

import FinalNumbersPanel from "./FinalNumbersPanel";
import type { EventData } from "@/lib/api";

/** An entrée choice by default; `courses`/`dish_courses` mirror what the serializer
 * sends, so the panel groups exactly as the backend validates. */
function makeEvent(over: Partial<EventData> = {}): EventData {
  return {
    id: 7,
    guaranteed_count: null,
    final_count: null,
    final_count_due: "2026-08-20",
    finals_status: "due_soon",
    menu_choices: { "1": null, "2": null },
    courses: [{ name: "Entrée", sort_order: 0 }, { name: "Dessert", sort_order: 1 }],
    dish_courses: { "1": 0, "2": 0, "3": 1, "4": 1 },
    ...over,
  } as EventData;
}

/** Both an entrée and a dessert choice — 150 guests means 300 tallies in total. */
const TWO_COURSES = makeEvent({
  menu_choices: { "1": null, "2": null, "3": null, "4": null },
});

function open(event: EventData = makeEvent(), onSaved = vi.fn()) {
  render(<FinalNumbersPanel event={event} dateFormat="MM/DD/YYYY" onSaved={onSaved} />);
  fireEvent.click(screen.getByText("Record final numbers"));
  return onSaved;
}

const setField = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

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
    setField("Final guarantee", "150");
    setField("Guaranteed count", "140");
    setField("Final count due", "2026-08-18");
    setField("Tally for Beef", "90");
    setField("Tally for Salmon", "60");

    fireEvent.click(screen.getByText("Save final numbers"));

    await waitFor(() => expect(recordEventFinals).toHaveBeenCalledTimes(1));
    expect(recordEventFinals).toHaveBeenCalledWith(7, {
      final_count: 150,
      final_count_due: "2026-08-18",
      guaranteed_count: 140,
      choice_counts: { "1": 90, "2": 60 },
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("blocks the save with a live message until the tallies add up", () => {  // AC7
    open();
    setField("Final guarantee", "150");
    setField("Tally for Beef", "90");
    setField("Tally for Salmon", "55");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Entrée choices must add up to the final guarantee (150) — they currently total 145.",
    );
    expect(screen.getByText("Save final numbers")).toBeDisabled();

    fireEvent.click(screen.getByText("Save final numbers"));
    expect(recordEventFinals).not.toHaveBeenCalled();

    setField("Tally for Salmon", "60");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Save final numbers")).not.toBeDisabled();
  });

  // ---- per-course grouping ----

  it("validates each course separately, not as one big sum", () => {  // AC7
    open(TWO_COURSES);
    setField("Final guarantee", "150");
    setField("Tally for Beef", "90");
    setField("Tally for Salmon", "60");      // Entrée = 150
    setField("Tally for Brownie", "100");
    setField("Tally for Cheesecake", "50");  // Dessert = 150

    // 300 tallies against a 150 guarantee — a single global sum would reject this.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Save final numbers")).not.toBeDisabled();
  });

  it("complains about only the course that is wrong, and names it", () => {
    open(TWO_COURSES);
    setField("Final guarantee", "150");
    setField("Tally for Beef", "90");
    setField("Tally for Salmon", "60");      // Entrée fine
    setField("Tally for Brownie", "100");
    setField("Tally for Cheesecake", "30");  // Dessert = 130

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("Dessert choices must add up");
    expect(alerts[0]).toHaveTextContent("currently total 130");
    // The good group shows its running total instead of an error.
    expect(within(screen.getByTestId("choice-group-0")).getByText("150 of 150 ✓")).toBeInTheDocument();
  });

  it("blocks the save when a whole course is left blank", () => {
    // Ticking a dish as offered is a commitment to collecting its numbers.
    open(TWO_COURSES);
    setField("Final guarantee", "150");
    setField("Tally for Beef", "90");
    setField("Tally for Salmon", "60");
    expect(screen.getByRole("alert")).toHaveTextContent("Dessert choices must add up");
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });

  it("labels a course-less group generically", () => {
    open(makeEvent({ courses: [], dish_courses: {} }));
    setField("Final guarantee", "150");
    setField("Tally for Beef", "90");
    expect(screen.getByRole("alert")).toHaveTextContent("Menu choices must add up");
  });

  it("never asks for a sum when no choices are offered", () => {  // AC7 scope
    open(makeEvent({ menu_choices: {} }));
    setField("Final guarantee", "150");
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
      menu_choices: { "1": 90, "2": 60 },
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
          menu_choices: { "1": 90, "2": 60 },
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
    setField("Final guarantee", "150");
    setField("Tally for Beef", "150");
    fireEvent.click(screen.getByText("Save final numbers"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Entrée choices must add up"));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("re-seeds when a dish stops being offered, instead of summing a stale tally", () => {
    // The panel outlives an edit of the menu above it. Counts seeded once at mount
    // kept summing the removed dish, so the panel said it added up and the backend
    // rejected the save.
    const view = render(
      <FinalNumbersPanel event={makeEvent()} dateFormat="MM/DD/YYYY" onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Record final numbers"));
    setField("Final guarantee", "50");
    setField("Tally for Beef", "30");
    setField("Tally for Salmon", "20");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    view.rerender(
      <FinalNumbersPanel
        event={makeEvent({ menu_choices: { "1": null } })}
        dateFormat="MM/DD/YYYY"
        onSaved={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Tally for Salmon")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("currently total 30");
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });

  it("keeps a typed tally when an extra dish is offered mid-edit", () => {
    const view = render(
      <FinalNumbersPanel
        event={makeEvent({ menu_choices: { "1": null } })}
        dateFormat="MM/DD/YYYY"
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Record final numbers"));
    setField("Tally for Beef", "30");
    view.rerender(
      <FinalNumbersPanel event={makeEvent()} dateFormat="MM/DD/YYYY" onSaved={vi.fn()} />,
    );
    expect(screen.getByLabelText("Tally for Beef")).toHaveValue(30);
    expect(screen.getByLabelText("Tally for Salmon")).toHaveValue(null);
  });

  it("refuses a negative tally that would otherwise 'add up'", () => {
    open();
    setField("Final guarantee", "50");
    setField("Tally for Beef", "60");
    setField("Tally for Salmon", "-10");
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be negative");
    expect(screen.getByText("Save final numbers")).toBeDisabled();
  });
});
