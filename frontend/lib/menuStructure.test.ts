import {
  assignDish, courseWarning, menuSections, moveDish, removeCourse, toggleChoice,
} from "./menuStructure";
import type { CourseData } from "@/lib/api";

const COURSES: CourseData[] = [
  { name: "Entrée", sort_order: 0 },
  { name: "Dessert", sort_order: 1 },
];
// 1 Beef, 2 Salmon, 3 Potatoes in Entrée; 4 Cheesecake in Dessert; 5 Rolls unassigned.
const DISH_COURSES = { "1": 0, "2": 0, "3": 0, "4": 1 };
const DISHES = [1, 2, 3, 4, 5];

const sections = (choices = {}, plated = true) =>
  menuSections(DISHES, COURSES, DISH_COURSES, choices, plated);

describe("menuSections", () => {
  it("groups dishes under their course, in menu order", () => {
    const [entree, dessert, table] = sections();
    expect(entree).toMatchObject({ courseIndex: 0, name: "Entrée", dishIds: [1, 2, 3] });
    expect(dessert).toMatchObject({ courseIndex: 1, name: "Dessert", dishIds: [4] });
    expect(table).toMatchObject({ courseIndex: null, name: null, dishIds: [5] });
  });

  it("sorts offered dishes to the top of their course", () => {  // AC5
    // Potatoes (3) sits between the two options in menu order; the or-pair must
    // still end up adjacent at the top.
    const [entree] = sections({ "1": null, "3": null });
    expect(entree.dishIds).toEqual([1, 3, 2]);
    expect(entree.chosenIds).toEqual([1, 3]);
  });

  it("drops the unassigned section when everything has a course", () => {  // AC4
    const out = menuSections([1, 4], COURSES, DISH_COURSES, {}, true);
    expect(out.map((s) => s.courseIndex)).toEqual([0, 1]);
  });

  it("keeps an empty course as a section so it can be filled", () => {
    const out = menuSections([4], COURSES, DISH_COURSES, {}, true);
    expect(out[0]).toMatchObject({ name: "Entrée", dishIds: [] });
  });

  it("treats a dish whose course index no longer exists as unassigned", () => {
    const out = menuSections([1], COURSES, { "1": 7 }, {}, true);
    expect(out.at(-1)).toMatchObject({ courseIndex: null, dishIds: [1] });
  });

  it("shows no choices at all when the booking isn't plated", () => {  // AC8
    const [entree] = sections({ "1": null, "2": null }, false);
    expect(entree.chosenIds).toEqual([]);
    expect(entree.dishIds).toEqual([1, 2, 3]);  // order untouched too
  });

  it("never treats an unassigned dish as an option", () => {
    const table = sections({ "5": null }).at(-1)!;
    expect(table.chosenIds).toEqual([]);
  });
});

describe("courseWarning", () => {
  it("warns on a single option — it looks like a choice but isn't one", () => {  // AC7
    const [entree] = sections({ "1": null });
    expect(courseWarning(entree)).toBe("a choice needs two options");
  });

  it("says nothing once there are two options", () => {
    const [entree] = sections({ "1": null, "2": null });
    expect(courseWarning(entree)).toBeNull();
  });

  it("says nothing for a course with no options at all", () => {
    const [entree] = sections();
    expect(courseWarning(entree)).toBeNull();
  });

  it("never warns on a non-plated booking — it has no choices to get wrong", () => {  // AC8
    const [entree] = sections({ "1": null }, false);
    expect(courseWarning(entree)).toBeNull();
  });
});

describe("moveDish", () => {
  it("hops into the next course when stepping past the end", () => {  // AC2
    const out = moveDish(3, 1, sections(), DISH_COURSES, {});
    expect(out.dishCourses["3"]).toBe(1);
  });

  it("hops into the previous course when stepping past the start", () => {
    const out = moveDish(4, -1, sections(), DISH_COURSES, {});
    expect(out.dishCourses["4"]).toBe(0);
  });

  it("lands in the unassigned section past the last course", () => {
    const out = moveDish(4, 1, sections(), DISH_COURSES, {});
    expect(out.dishCourses["4"]).toBeUndefined();
  });

  it("clears the choice flag when the dish changes course", () => {  // AC2
    const choices = { "1": null, "2": null };
    // 2 is last of the offered pair; stepping down moves it out of Entrée.
    const secs = sections(choices);
    const last = secs[0].dishIds.at(-1)!;
    const out = moveDish(last, 1, secs, DISH_COURSES, choices);
    expect(out.menuChoices[last]).toBeUndefined();
  });

  it("does nothing at the very top or very bottom of the menu", () => {
    const secs = sections();
    expect(moveDish(1, -1, secs, DISH_COURSES, {}).dishCourses).toEqual(DISH_COURSES);
    expect(moveDish(5, 1, secs, DISH_COURSES, {}).dishCourses).toEqual(DISH_COURSES);
  });

  it("ignores a dish that isn't on the menu", () => {
    expect(moveDish(99, 1, sections(), DISH_COURSES, {}).dishCourses).toEqual(DISH_COURSES);
  });
});

describe("assignDish", () => {
  it("moves a dish into a course and clears its flag", () => {
    const out = assignDish(1, 1, DISH_COURSES, { "1": null });
    expect(out.dishCourses["1"]).toBe(1);
    expect(out.menuChoices["1"]).toBeUndefined();
  });

  it("keeps the flag when the course doesn't actually change", () => {
    const out = assignDish(1, 0, DISH_COURSES, { "1": 90 });
    expect(out.menuChoices["1"]).toBe(90);  // a recorded tally survives
  });

  it("unassigns with null", () => {
    expect(assignDish(1, null, DISH_COURSES, {}).dishCourses["1"]).toBeUndefined();
  });
});

describe("toggleChoice", () => {
  it("marks and unmarks a dish as an option", () => {
    expect(toggleChoice({}, 1)).toEqual({ "1": null });
    expect(toggleChoice({ "1": null }, 1)).toEqual({});
  });

  it("leaves other dishes alone", () => {
    expect(toggleChoice({ "2": 40 }, 1)).toEqual({ "1": null, "2": 40 });
  });
});

describe("removeCourse", () => {
  it("drops the course's dishes into the unassigned section", () => {  // AC2
    const out = removeCourse(0, COURSES, DISH_COURSES, {});
    expect(out.courses.map((c) => c.name)).toEqual(["Dessert"]);
    // Entrée's dishes lose their course; Dessert shifts 1 → 0.
    expect(out.dishCourses).toEqual({ "4": 0 });
  });

  it("clears the choice flags of the dishes it orphans", () => {
    const out = removeCourse(0, COURSES, DISH_COURSES, { "1": null, "2": null, "4": null });
    expect(out.menuChoices).toEqual({ "4": null });
  });

  it("renumbers sort_order to match the new positions", () => {
    const out = removeCourse(0, COURSES, DISH_COURSES, {});
    expect(out.courses[0].sort_order).toBe(0);
  });
});
