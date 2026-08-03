import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CourseData, MenuChoices } from "@/lib/api";

// REL-451 — the one Menu card's STRUCTURE: courses holding dishes, the guest choice
// marked on a row inside its course, and the course-scoped dish picker. The payload
// side is covered on the real pages (page.choices.test.tsx / page.edit.test.tsx);
// this file pins the states those page tests can't reach cheaply.

const h = vi.hoisted(() => ({ priceEstimate: vi.fn() }));

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({ data: [
    { id: 1, name: "Roast Beef", category: 1, is_vegetarian: false, dietary_tags: [
      { id: 3, slug: "gluten_free", label: "Gluten-free", short_label: "GF", kind: "dietary" },
    ] },
    { id: 2, name: "Baked Salmon", category: 1, is_vegetarian: false, dietary_tags: [] },
    { id: 3, name: "Mashed Potatoes", category: 1, is_vegetarian: true, dietary_tags: [] },
    { id: 4, name: "Cheesecake", category: 2, is_vegetarian: true, dietary_tags: [] },
    { id: 5, name: "Dinner Rolls", category: 2, is_vegetarian: true, dietary_tags: [] },
  ] }),
  useCategories: () => ({ data: [
    { id: 1, display_name: "Mains", display_order: 1 },
    { id: 2, display_name: "Desserts", display_order: 2 },
  ] }),
  useMenus: () => ({ data: [{ id: 7, name: "Autumn Plated", dish_count: 2 }], isLoading: false }),
}));

vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      priceEstimate: h.priceEstimate,
      // Template 7 puts both dishes in a course of its own — a different course from
      // the one the booking had them in, which is what must clear the flags.
      getMenu: () => Promise.resolve({
        portions: [{ dish_id: 1 }, { dish_id: 2 }],
        courses: [{ name: "Mains", sort_order: 0 }],
        dish_courses: { "1": 0, "2": 0 },
        price_tiers: [],
      }),
    },
  };
});

import MenuBuilder from "./MenuBuilder";

/** The card is controlled — the page owns the structure. This is that page. */
function Harness({
  dishIds = [1, 2, 3],
  courses: initialCourses = [{ name: "Entrée", sort_order: 0 }] as CourseData[],
  dishCourses: initialDishCourses = { "1": 0, "2": 0, "3": 0 } as Record<string, number>,
  menuChoices: initialChoices = {} as MenuChoices,
  plated = true,
  serviceStyleLabel,
}: {
  dishIds?: number[];
  courses?: CourseData[];
  dishCourses?: Record<string, number>;
  menuChoices?: MenuChoices;
  plated?: boolean;
  serviceStyleLabel?: string;
}) {
  const [courses, setCourses] = useState(initialCourses);
  const [dishCourses, setDishCourses] = useState(initialDishCourses);
  const [menuChoices, setMenuChoices] = useState(initialChoices);
  const [selected, setSelected] = useState(dishIds);
  return (
    <MenuBuilder
      selectedDishIds={selected}
      basedOnTemplate={null}
      onChange={({ dish_ids }) => setSelected(dish_ids)}
      courses={courses}
      dishCourses={dishCourses}
      menuChoices={menuChoices}
      plated={plated}
      serviceStyleLabel={serviceStyleLabel}
      onStructureChange={(v) => {
        setCourses(v.courses);
        setDishCourses(v.dishCourses);
        setMenuChoices(v.menuChoices);
      }}
    />
  );
}

const chip = (dish: string) => `Mark ${dish} as a guest choice`;
const unchip = (dish: string) => `Remove ${dish} as a guest choice`;
/** Row order as rendered, which is what the *or* pairing depends on. Keyed off each
 * row's ✕, so it must exclude the course ✕ and the "Remove … as a guest choice" chip. */
const rowOrder = () =>
  screen.getAllByRole("button", { name: /^Remove / })
    .map((b) => b.getAttribute("aria-label")!)
    .filter((l) => !l.startsWith("Remove course ") && !l.endsWith("as a guest choice"))
    .map((l) => l.replace("Remove ", ""));

beforeEach(() => h.priceEstimate.mockReset());

describe("MenuBuilder — courses as structure (AC2, AC4)", () => {
  it("adds, renames and removes a course, dropping its dishes to On the table", async () => {
    render(<Harness />);
    // Rename in place — the course title IS the field.
    fireEvent.change(screen.getByLabelText("Course 1 name"), { target: { value: "Main" } });
    expect(screen.getByLabelText("Course 1 name")).toHaveValue("Main");

    fireEvent.click(screen.getByText("+ Add course"));
    expect(await screen.findByLabelText("Course 2 name")).toBeInTheDocument();

    // Removing a course drops its dishes into the unassigned section, never a
    // neighbouring course (deliberate deviation from the prototype).
    expect(screen.queryByText("On the table")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove course Main"));
    expect(await screen.findByText("On the table")).toBeInTheDocument();
    expect(rowOrder()).toEqual(["Roast Beef", "Baked Salmon", "Mashed Potatoes"]);
  });

  it("hops a dish into the neighbouring course with the arrows, clearing its flag", async () => {
    render(<Harness
      courses={[{ name: "Entrée", sort_order: 0 }, { name: "Dessert", sort_order: 1 }]}
      dishIds={[1, 2, 4]}
      dishCourses={{ "1": 0, "2": 0, "4": 1 }}
      menuChoices={{ "1": null, "2": null }}
    />);
    // Salmon is the last row of Entrée; stepping down lands it in Dessert.
    fireEvent.click(screen.getByLabelText("Move Baked Salmon down"));
    // Nothing arrives in a course pre-marked as one of its options, so the flag goes.
    await waitFor(() =>
      expect(screen.queryByLabelText(unchip("Baked Salmon"))).not.toBeInTheDocument());
    expect(screen.getByLabelText(chip("Baked Salmon"))).toBeInTheDocument();
  });

  it("moves a dish out of the MIDDLE of a course, not just off its ends", async () => {
    // ↑/↓ mean previous/next course, not "one row". When they only fired at a
    // section boundary, a dish buried in a long list could not be moved until every
    // dish above it had been moved first.
    render(<Harness
      courses={[{ name: "Entrée", sort_order: 0 }, { name: "Dessert", sort_order: 1 }]}
      dishIds={[1, 2, 3, 4]}
      dishCourses={{ "1": 0, "2": 0, "3": 0, "4": 1 }}
    />);
    // Baked Salmon sits between Roast Beef and Mashed Potatoes.
    fireEvent.click(screen.getByLabelText("Move Baked Salmon down"));
    await waitFor(() =>
      expect(rowOrder()).toEqual(["Roast Beef", "Mashed Potatoes", "Baked Salmon", "Cheesecake"]));
  });

  it("draws no insertion line for a drag within one course", async () => {
    // Order within a course isn't part of the save payload, so a same-course drop
    // can't reorder anything — the line would promise a move that never happens.
    render(<Harness />);
    const potatoes = screen.getByText("Mashed Potatoes").closest("div[draggable]")!;
    const beef = screen.getByText("Roast Beef").closest("div[draggable]")!;
    fireEvent.dragStart(potatoes);
    fireEvent.dragOver(beef);
    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
    fireEvent.drop(beef);
    expect(rowOrder()).toEqual(["Roast Beef", "Baked Salmon", "Mashed Potatoes"]);
  });

  it("moves a dish by dragging it onto another course, clearing its flag", async () => {
    render(<Harness
      courses={[{ name: "Entrée", sort_order: 0 }, { name: "Dessert", sort_order: 1 }]}
      dishIds={[1, 2, 4]}
      dishCourses={{ "1": 0, "2": 0, "4": 1 }}
      menuChoices={{ "1": null, "2": null }}
    />);
    const salmonRow = screen.getByText("Baked Salmon").closest("div[draggable]")!;
    const cheesecakeRow = screen.getByText("Cheesecake").closest("div[draggable]")!;

    fireEvent.dragStart(salmonRow);
    fireEvent.dragOver(cheesecakeRow);
    // The insertion line shows where the row would land.
    expect(await screen.findByTestId("drop-line")).toBeInTheDocument();
    fireEvent.drop(cheesecakeRow);

    // Same rule as the arrows: a cross-course landing clears the flag.
    await waitFor(() =>
      expect(screen.queryByLabelText(unchip("Baked Salmon"))).not.toBeInTheDocument());
    expect(screen.queryByTestId("drop-line")).not.toBeInTheDocument();
  });

  it("drops the On the table section when it empties", async () => {
    render(<Harness dishIds={[1, 2]} dishCourses={{ "1": 0 }} />);
    expect(screen.getByText("On the table")).toBeInTheDocument();
    // Step the unassigned dish back up into the course above it.
    fireEvent.click(screen.getByLabelText("Move Baked Salmon up"));
    await waitFor(() => expect(screen.queryByText("On the table")).not.toBeInTheDocument());
  });
});

describe("MenuBuilder — marking the guest's choice (AC5, AC6, AC7)", () => {
  it("flags a dish, sorts it to the top of its course and joins the pair with 'or'", async () => {
    render(<Harness />);
    // Unflagged rows offer the muted invitation; flagged ones the persistent chip.
    expect(screen.getByLabelText(chip("Mashed Potatoes"))).toHaveTextContent("make it a choice");
    expect(screen.queryByText("or")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(chip("Mashed Potatoes")));
    fireEvent.click(screen.getByLabelText(chip("Baked Salmon")));

    // Both options sort above the every-plate dish, so the pair is never separated.
    await waitFor(() =>
      expect(rowOrder()).toEqual(["Baked Salmon", "Mashed Potatoes", "Roast Beef"]));
    expect(screen.getByLabelText(unchip("Baked Salmon"))).toHaveTextContent("guests choose");
    // Exactly one *or*: two options make ONE group, never two brackets (AC6).
    expect(screen.getAllByText("or")).toHaveLength(1);
  });

  it("returns a row to a plain dish when unflagged", async () => {
    render(<Harness menuChoices={{ "1": null, "2": null }} />);
    expect(screen.getAllByText("or")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(unchip("Baked Salmon")));
    await waitFor(() => expect(screen.queryByText("or")).not.toBeInTheDocument());
    expect(screen.getByLabelText(chip("Baked Salmon"))).toHaveTextContent("make it a choice");
  });

  it("warns on a single option without blocking, and clears on the second", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(chip("Roast Beef")));
    expect(await screen.findByText("a choice needs two options")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(chip("Baked Salmon")));
    await waitFor(() =>
      expect(screen.queryByText("a choice needs two options")).not.toBeInTheDocument());
  });

  it("never offers a choice on an un-coursed dish", async () => {
    // A choice belongs to a course, so "On the table" rows carry no chip at all.
    render(<Harness dishIds={[1, 2]} dishCourses={{ "1": 0 }} />);
    expect(screen.getByText("On the table")).toBeInTheDocument();
    expect(screen.queryByLabelText(chip("Baked Salmon"))).not.toBeInTheDocument();
    expect(screen.getByLabelText(chip("Roast Beef"))).toBeInTheDocument();
  });
});

describe("MenuBuilder — the structure follows the dishes", () => {
  it("takes courses and flags with the menu when it is cleared", async () => {
    // A course assignment or choice flag pointing at a dish no longer on the booking
    // is a stale key in the save payload.
    const seen: Array<{ dishCourses: Record<string, number>; menuChoices: MenuChoices }> = [];
    render(
      <MenuBuilder
        selectedDishIds={[1, 2]}
        basedOnTemplate={null}
        onChange={() => {}}
        courses={[{ name: "Entrée", sort_order: 0 }]}
        dishCourses={{ "1": 0, "2": 0 }}
        menuChoices={{ "1": null, "2": null }}
        plated
        onStructureChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(screen.getByText("Clear All"));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)!.dishCourses).toEqual({});
    expect(seen.at(-1)!.menuChoices).toEqual({});
  });

  it("drops the choice flags when a template rewrites the courses", async () => {
    // Loading a template reassigns every dish, which is the same thing dragging a
    // dish across courses does — and that clears the flag (AC2). Keeping it would
    // leave a dish marked as an option in a course nobody declared one for.
    const seen: MenuChoices[] = [];
    render(
      <MenuBuilder
        selectedDishIds={[1, 2]}
        basedOnTemplate={null}
        onChange={() => {}}
        courses={[{ name: "Entrée", sort_order: 0 }]}
        dishCourses={{ "1": 0, "2": 0 }}
        menuChoices={{ "1": null, "2": null }}
        plated
        onStructureChange={(v) => seen.push(v.menuChoices)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Load from template"), { target: { value: "7" } });
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)).toEqual({});
  });
});

describe("MenuBuilder — service style (AC8)", () => {
  it("shows no choice affordance on a non-plated booking, but keeps the courses", () => {
    render(<Harness plated={false} menuChoices={{ "1": null, "2": null }} />);
    // Courses are legitimate on any style — only the choice affordances are gated.
    expect(screen.getByLabelText("Course 1 name")).toHaveValue("Entrée");
    expect(screen.queryByLabelText(chip("Roast Beef"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(unchip("Roast Beef"))).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
    expect(screen.queryByText("guests choose")).not.toBeInTheDocument();
  });

  it("renders a course-less booking as a flat list with no scaffolding", () => {
    render(<Harness courses={[]} dishCourses={{}} plated />);
    expect(screen.queryByLabelText("Course 1 name")).not.toBeInTheDocument();
    expect(screen.queryByText("On the table")).not.toBeInTheDocument();
    expect(screen.queryByText("+ Add course")).not.toBeInTheDocument();
    // Even plated: a choice belongs to a course, so there is nothing to mark yet.
    expect(screen.queryByLabelText(chip("Roast Beef"))).not.toBeInTheDocument();
    expect(screen.getByText("3 dishes")).toBeInTheDocument();
    expect(screen.getByText("Group into courses")).toBeInTheDocument();
  });

  it("names the service style and guest count above the menu", () => {
    render(<Harness serviceStyleLabel="Plated" />);
    expect(screen.getByTestId("menu-service-line")).toHaveTextContent("Plated");
  });
});

describe("MenuBuilder — the course-scoped dish picker (AC8b)", () => {
  const openPicker = () => {
    // Each course has its own "+ dish"; the first is the Entrée's.
    fireEvent.click(screen.getAllByText("+ dish")[0]);
  };

  it("opens inside the course it adds to, and adds straight into it", async () => {
    render(<Harness dishIds={[1]} dishCourses={{ "1": 0 }} />);
    openPicker();
    const picker = await screen.findByTestId("dish-picker");
    expect(picker).toHaveAttribute("aria-label", "Add a dish to Entrée");

    // No second assignment step — the dish lands in that course.
    fireEvent.click(within(picker).getByLabelText("Cheesecake — add to Entrée"));
    await waitFor(() => expect(screen.getByLabelText("Remove Cheesecake")).toBeInTheDocument());
    expect(screen.queryByText("On the table")).not.toBeInTheDocument();
  });

  it("filters by search and by category tab, and greys what's already on", async () => {
    render(<Harness dishIds={[1]} dishCourses={{ "1": 0 }} />);
    openPicker();
    const picker = await screen.findByTestId("dish-picker");

    // Already on the booking — offered but not re-addable.
    const onMenu = within(picker).getByLabelText(/Roast Beef.*already on menu/);
    expect(onMenu).toBeDisabled();

    // The tab, not the group heading of the same name.
    fireEvent.click(within(picker).getByRole("button", { name: "Desserts" }));
    expect(within(picker).queryByText("Baked Salmon")).not.toBeInTheDocument();
    expect(within(picker).getByText("Cheesecake")).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole("button", { name: "All" }));
    fireEvent.change(within(picker).getByLabelText("Search your dishes"), {
      target: { value: "salmon" },
    });
    expect(within(picker).getByText("Baked Salmon")).toBeInTheDocument();
    expect(within(picker).queryByText("Cheesecake")).not.toBeInTheDocument();
  });

  it("closes three ways — Esc, Cancel, and the trigger that reads Done", async () => {
    render(<Harness dishIds={[1]} dishCourses={{ "1": 0 }} />);

    openPicker();
    expect(await screen.findByTestId("dish-picker")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();  // the trigger, while open
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dish-picker")).not.toBeInTheDocument());

    openPicker();
    fireEvent.click(within(await screen.findByTestId("dish-picker")).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByTestId("dish-picker")).not.toBeInTheDocument());

    openPicker();
    await screen.findByTestId("dish-picker");
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(screen.queryByTestId("dish-picker")).not.toBeInTheDocument());
  });
});
