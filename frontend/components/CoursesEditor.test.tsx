import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({ data: [{ id: 1, name: "Soup" }, { id: 2, name: "Steak" }, { id: 3, name: "Cake" }] }),
}));

import CoursesEditor from "./CoursesEditor";
import { CourseData, EntreeChoices } from "@/lib/api";

/** Controlled harness so multi-step edits (add course, then assign a dish) persist. */
function Harness({
  initCourses = [],
  initDish = {},
  initChoices = {},
  plated = false,
}: {
  initCourses?: CourseData[];
  initDish?: Record<string, number>;
  initChoices?: EntreeChoices;
  plated?: boolean;
}) {
  const [courses, setCourses] = useState<CourseData[]>(initCourses);
  const [dishCourses, setDishCourses] = useState<Record<string, number>>(initDish);
  const [entreeChoices, setEntreeChoices] = useState<EntreeChoices>(initChoices);
  return (
    <>
      <CoursesEditor
        courses={courses}
        dishCourses={dishCourses}
        entreeChoices={entreeChoices}
        plated={plated}
        onChange={({ courses, dishCourses, entreeChoices }) => {
          setCourses(courses);
          setDishCourses(dishCourses);
          setEntreeChoices(entreeChoices);
        }}
        selectedDishIds={[1, 2, 3]}
        editing
      />
      <div data-testid="state">{JSON.stringify({ courses, dishCourses, entreeChoices })}</div>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent!);

describe("CoursesEditor", () => {
  it("adds a course with sort_order = its position", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("+ Add course"));
    fireEvent.click(screen.getByText("+ Add course"));
    expect(state().courses).toEqual([
      { name: "", sort_order: 0 },
      { name: "", sort_order: 1 },
    ]);
  });

  it("names a course and assigns a dish to it", () => {
    render(<Harness initCourses={[{ name: "Starter", sort_order: 0 }]} />);
    fireEvent.change(screen.getByLabelText("Course for Steak"), { target: { value: "0" } });
    expect(state().courses[0]).toEqual({ name: "Starter", sort_order: 0 });
    expect(state().dishCourses).toEqual({ "2": 0 });
  });

  it("reordering courses remaps the dish→course indices so assignments follow", () => {
    render(<Harness
      initCourses={[{ name: "A", sort_order: 0 }, { name: "B", sort_order: 1 }]}
      initDish={{ "1": 0, "2": 1 }}
    />);
    fireEvent.click(screen.getByLabelText("Move course 1 down")); // A(0)<->B(1)
    expect(state().courses.map((c: CourseData) => c.name)).toEqual(["B", "A"]);
    // Soup was on A (now index 1), Steak on B (now index 0).
    expect(state().dishCourses).toEqual({ "1": 1, "2": 0 });
  });

  it("view mode lists each course with its assigned dishes", () => {
    render(
      <CoursesEditor
        courses={[{ name: "Starter", sort_order: 0 }]}
        dishCourses={{ "1": 0, "2": 0 }}
        onChange={() => {}}
        selectedDishIds={[1, 2, 3]}
        editing={false}
      />,
    );
    expect(screen.getByText(/Starter/).closest("div")).toHaveTextContent("Starter: Soup, Steak");
    expect(screen.queryByText("+ Add course")).not.toBeInTheDocument(); // read-only
  });

  it("removing a course unassigns its dishes and shifts higher indices down", () => {
    render(<Harness
      initCourses={[{ name: "A", sort_order: 0 }, { name: "B", sort_order: 1 }, { name: "C", sort_order: 2 }]}
      initDish={{ "1": 0, "2": 1, "3": 2 }}
    />);
    fireEvent.click(screen.getAllByText("Remove")[1]); // remove B (index 1)
    expect(state().courses.map((c: CourseData) => c.name)).toEqual(["A", "C"]);
    // Soup stays on A(0); Steak (was on removed B) unassigned; Cake shifts 2→1.
    expect(state().dishCourses).toEqual({ "1": 0, "3": 1 });
  });

  // ---- Entrée choices (REL-419) ----

  it("offers no choice checkbox unless the booking is plated", () => {  // AC1
    render(<Harness initCourses={[{ name: "Entrée", sort_order: 0 }]} />);
    expect(screen.queryByLabelText("Offer Steak as a choice")).not.toBeInTheDocument();
  });

  it("marks two entrée dishes as offered, with no count field at quote time", () => {  // AC1
    render(<Harness initCourses={[{ name: "Entrée", sort_order: 0 }]} plated />);
    fireEvent.click(screen.getByLabelText("Offer Steak as a choice"));
    fireEvent.click(screen.getByLabelText("Offer Cake as a choice"));
    // Flagged with NO tally — counts arrive at finals, on the event.
    expect(state().entreeChoices).toEqual({ "2": null, "3": null });
    // No count input and no validation message anywhere in the proposal editor.
    expect(screen.queryByLabelText(/Tally for/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un-ticking a dish drops it from the offered map", () => {
    render(<Harness initChoices={{ "2": null }} plated />);
    fireEvent.click(screen.getByLabelText("Offer Steak as a choice"));
    expect(state().entreeChoices).toEqual({});
  });

  it("keeps a recorded tally when the offering is re-emitted", () => {
    // The event editor round-trips {dish: count}; toggling another dish must not
    // blank a count the finals panel already recorded.
    render(<Harness initChoices={{ "2": 90 }} plated />);
    fireEvent.click(screen.getByLabelText("Offer Cake as a choice"));
    expect(state().entreeChoices).toEqual({ "2": 90, "3": null });
  });

  it("shows the choice checkbox on a plated booking that has no courses yet", () => {
    render(<Harness plated />);
    expect(screen.getByLabelText("Offer Steak as a choice")).toBeInTheDocument();
    expect(screen.queryByLabelText("Course for Steak")).not.toBeInTheDocument();
  });

  it("view mode marks which dishes are offered as a choice", () => {
    render(
      <CoursesEditor
        courses={[{ name: "Entrée", sort_order: 0 }]}
        dishCourses={{ "2": 0, "3": 0 }}
        entreeChoices={{ "2": null }}
        plated
        onChange={() => {}}
        selectedDishIds={[1, 2, 3]}
        editing={false}
      />,
    );
    expect(screen.getByText(/Entrée/).closest("div")).toHaveTextContent("Entrée: Steak (choice), Cake");
  });
});
