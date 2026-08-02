import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({
    data: [
      { id: 1, name: "Beef" }, { id: 2, name: "Salmon" },
      { id: 3, name: "Brownie" }, { id: 4, name: "Cheesecake" },
    ],
  }),
}));

import MenuChoicesEditor from "./MenuChoicesEditor";
import { CourseData, MenuChoices } from "@/lib/api";

const COURSES: CourseData[] = [
  { name: "Entrée", sort_order: 0 },
  { name: "Dessert", sort_order: 1 },
];
const DISH_COURSES = { "1": 0, "2": 0, "3": 1, "4": 1 };

/** Controlled harness — the page owns the state, as both editors do. */
function Harness({
  courses = COURSES,
  dishCourses = DISH_COURSES,
  initChoices = {},
  editing = true,
}: {
  courses?: CourseData[];
  dishCourses?: Record<string, number>;
  initChoices?: MenuChoices;
  editing?: boolean;
}) {
  const [menuChoices, setMenuChoices] = useState<MenuChoices>(initChoices);
  return (
    <>
      <MenuChoicesEditor
        courses={courses}
        dishCourses={dishCourses}
        menuChoices={menuChoices}
        onChange={setMenuChoices}
        selectedDishIds={[1, 2, 3, 4]}
        editing={editing}
      />
      <div data-testid="state">{JSON.stringify(menuChoices)}</div>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!);

describe("MenuChoicesEditor", () => {
  it("explains itself BEFORE the list, in its own card", () => {
    // The bug this replaces: the ticks lived inside the COURSES card under the words
    // "No courses", with the one line of explanation below the list.
    render(<Harness />);
    const card = screen.getByTestId("menu-choices");
    expect(within(card).getByText("Menu choices")).toBeInTheDocument();
    expect(card).toHaveTextContent(/the guest picks from what you offer/i);
    expect(card).toHaveTextContent(/needs its guest numbers at finals/i);
  });

  it("groups the dishes under their course", () => {
    render(<Harness />);
    const card = screen.getByTestId("menu-choices");
    expect(within(card).getByText("Entrée")).toBeInTheDocument();
    expect(within(card).getByText("Dessert")).toBeInTheDocument();
  });

  it("marks dishes as offered, with no count field anywhere", () => {  // AC1
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Offer Beef as a choice"));
    fireEvent.click(screen.getByLabelText("Offer Salmon as a choice"));
    expect(state()).toEqual({ "1": null, "2": null });
    // Proposal time: no tallies, no sum, no validation.
    expect(screen.queryByLabelText(/Tally for/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers a choice in more than one course", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Offer Beef as a choice"));
    fireEvent.click(screen.getByLabelText("Offer Salmon as a choice"));
    fireEvent.click(screen.getByLabelText("Offer Brownie as a choice"));
    fireEvent.click(screen.getByLabelText("Offer Cheesecake as a choice"));
    expect(state()).toEqual({ "1": null, "2": null, "3": null, "4": null });
  });

  it("un-ticking drops the dish from the offered map", () => {
    render(<Harness initChoices={{ "1": null }} />);
    fireEvent.click(screen.getByLabelText("Offer Beef as a choice"));
    expect(state()).toEqual({});
  });

  it("keeps a recorded tally when another dish is ticked", () => {
    // The event editor round-trips {dish: count}; ticking must not blank a count
    // the finals panel already recorded.
    render(<Harness initChoices={{ "1": 90 }} />);
    fireEvent.click(screen.getByLabelText("Offer Salmon as a choice"));
    expect(state()).toEqual({ "1": 90, "2": null });
  });

  it("warns when a course offers only one dish", () => {  // AC1 rule 2
    // A "choice" of one is 150 guests all choosing beef — the tick has no effect
    // worth signing. Non-blocking at quote time, but no longer silent.
    render(<Harness initChoices={{ "1": null }} />);
    expect(screen.getByText("A choice needs at least two options.")).toBeInTheDocument();
    // …and stops warning once it's a real choice — it never blocks anything.
    fireEvent.click(screen.getByLabelText("Offer Salmon as a choice"));
    expect(screen.queryByText("A choice needs at least two options.")).not.toBeInTheDocument();
  });

  it("offers no checkbox at all for a dish that isn't in a course", () => {  // AC1 rule 1
    // The old card invited nonsense: ticking Dinner Rolls as a "guest choice" when
    // it belongs to no course, so there is nothing for it to sum against at finals.
    render(<Harness dishCourses={{ "1": 0, "2": 0 }} />);
    expect(screen.getByLabelText("Offer Beef as a choice")).toBeInTheDocument();
    expect(screen.queryByLabelText("Offer Brownie as a choice")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Offer Cheesecake as a choice")).not.toBeInTheDocument();
    expect(
      screen.getByText("Assign these to a course first — a choice belongs to a course."),
    ).toBeInTheDocument();
  });

  it("offers nothing when the booking has no courses at all", () => {  // AC1 rule 1
    render(<Harness courses={[]} dishCourses={{}} />);
    expect(screen.queryByLabelText(/Offer .* as a choice/)).not.toBeInTheDocument();
    expect(screen.getByTestId("menu-choices")).toHaveTextContent(/Assign these to a course first/);
  });

  it("points at where the numbers go, once something is offered", () => {
    render(<Harness initChoices={{ "1": null, "2": null }} />);
    expect(screen.getByTestId("menu-choices")).toHaveTextContent(
      /enter how many guests picked each one in “Final numbers”/,
    );
  });

  it("falls back to a flat list when the booking has no courses", () => {
    render(<Harness courses={[]} dishCourses={{}} />);
    const card = screen.getByTestId("menu-choices");
    expect(within(card).getByText("Dishes")).toBeInTheDocument();
    expect(card).toHaveTextContent(/Add courses to group these/);
  });

  it("lists a dish left unassigned to any course separately", () => {
    render(<Harness dishCourses={{ "1": 0, "2": 0 }} />);
    const card = screen.getByTestId("menu-choices");
    expect(within(card).getByText("Entrée")).toBeInTheDocument();
    expect(within(card).getByText("Dishes")).toBeInTheDocument();  // the unassigned pair
  });

  it("read-only mode shows only what is offered, with no checkboxes", () => {
    render(<Harness initChoices={{ "1": null, "2": null }} editing={false} />);
    const card = screen.getByTestId("menu-choices");
    expect(within(card).getByText("Beef")).toBeInTheDocument();
    expect(within(card).queryByText("Brownie")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Offer .* as a choice/)).not.toBeInTheDocument();
  });

  it("read-only mode says so when nothing is offered", () => {
    render(<Harness editing={false} />);
    expect(screen.getByText("No choices offered.")).toBeInTheDocument();
  });
});
