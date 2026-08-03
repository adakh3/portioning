import {
  choiceTallyError, choiceTallyTotal, finalsPill, groupChoicesByCourse, offeredChoiceIds,
} from "./finals";
import type { CourseData } from "@/lib/api";

describe("finalsPill", () => {
  it("is amber as the due date approaches", () => {  // AC4
    expect(finalsPill("due_soon")).toEqual({ label: "Finals due", color: "amber", showsDueDate: true });
  });

  it("is red once the due date has passed", () => {  // AC5
    expect(finalsPill("overdue")).toEqual({ label: "Finals overdue", color: "red", showsDueDate: true });
  });

  it("is green once the numbers are in, and drops the date", () => {  // AC6
    expect(finalsPill("recorded")).toEqual({ label: "Finals recorded", color: "green", showsDueDate: false });
  });

  it("is a quiet slate reminder while the date is still far off", () => {
    expect(finalsPill("awaiting")?.color).toBe("slate");
  });

  it("shows nothing when there is nothing to chase", () => {
    expect(finalsPill(null)).toBeNull();
  });
});

describe("offeredChoiceIds", () => {
  it("returns the offered dish ids in a stable order", () => {
    expect(offeredChoiceIds({ "12": null, "3": 40 })).toEqual([3, 12]);
  });

  it("is empty when nothing is offered", () => {
    expect(offeredChoiceIds(undefined)).toEqual([]);
    expect(offeredChoiceIds({})).toEqual([]);
  });
});

// A choice belongs to a course, and every guest picks one dish per course that offers
// one — so each course is validated on its own. Mirrors `choice_groups` on the
// backend; if these two ever disagree the panel green-lights a rejected save.
const COURSES: CourseData[] = [
  { name: "Entrée", sort_order: 0 },
  { name: "Dessert", sort_order: 1 },
];
// Beef + Salmon are the entrée; Brownie + Cake the dessert.
const DISH_COURSES = { "1": 0, "2": 0, "3": 1, "4": 1 };

describe("groupChoicesByCourse", () => {
  it("groups the offered dishes under their course, in course order", () => {
    const groups = groupChoicesByCourse(
      { "1": null, "2": null, "3": null, "4": null }, COURSES, DISH_COURSES,
    );
    expect(groups).toEqual([
      { courseName: "Entrée", dishIds: [1, 2] },
      { courseName: "Dessert", dishIds: [3, 4] },
    ]);
  });

  it("only includes courses that actually offer a choice", () => {
    const groups = groupChoicesByCourse({ "1": null, "2": null }, COURSES, DISH_COURSES);
    expect(groups).toEqual([{ courseName: "Entrée", dishIds: [1, 2] }]);
  });

  it("puts course-less choices in one trailing unnamed group", () => {
    const groups = groupChoicesByCourse({ "1": null, "9": null }, COURSES, DISH_COURSES);
    expect(groups).toEqual([
      { courseName: "Entrée", dishIds: [1] },
      { courseName: null, dishIds: [9] },
    ]);
  });

  it("is one unnamed group when the booking has no courses at all", () => {
    expect(groupChoicesByCourse({ "1": null, "2": null }, [], {})).toEqual([
      { courseName: null, dishIds: [1, 2] },
    ]);
  });

  it("is empty when nothing is offered", () => {
    expect(groupChoicesByCourse({}, COURSES, DISH_COURSES)).toEqual([]);
  });
});

describe("choiceTallyTotal", () => {
  it("sums only the dishes in that group", () => {
    expect(choiceTallyTotal({ "1": "90", "2": "60", "3": "150" }, [1, 2])).toBe(150);
  });

  it("treats blank and junk as zero", () => {
    expect(choiceTallyTotal({ "1": "90", "2": "", "3": "abc" }, [1, 2, 3])).toBe(90);
  });
});

describe("choiceTallyError", () => {
  const entree = { courseName: "Entrée", dishIds: [1, 2] };

  it("passes when the group hits the guarantee", () => {  // AC7
    expect(choiceTallyError({ "1": "90", "2": "60" }, 150, entree)).toBeNull();
  });

  it("names the course when the group undershoots", () => {  // AC7
    const msg = choiceTallyError({ "1": "90", "2": "55" }, 150, entree);
    expect(msg).toMatch(/^Entrée choices must add up to the final guarantee \(150\)/);
    expect(msg).toMatch(/currently total 145/);
  });

  it("names the course when the group overshoots", () => {
    expect(choiceTallyError({ "1": "100", "2": "60" }, 150, entree)).toMatch(/currently total 160/);
  });

  it("ignores tallies belonging to another course", () => {
    // A choice of main AND of dessert for 150 guests is 300 tallies in total —
    // summing across groups would make a correct breakdown impossible to save.
    expect(choiceTallyError({ "1": "90", "2": "60", "3": "150" }, 150, entree)).toBeNull();
  });

  it("blocks a group left entirely blank", () => {
    // Ticking a dish as offered is a commitment to collecting its numbers.
    const dessert = { courseName: "Dessert", dishIds: [3, 4] };
    expect(choiceTallyError({ "1": "90", "2": "60" }, 150, dessert)).toMatch(/currently total 0/);
  });

  it("falls back to a generic label with no course", () => {
    expect(choiceTallyError({ "1": "10" }, 150, { courseName: null, dishIds: [1] }))
      .toMatch(/^Menu choices must add up/);
  });

  it("refuses a negative tally that would otherwise 'add up'", () => {
    expect(choiceTallyError({ "1": "160", "2": "-10" }, 150, entree)).toMatch(/cannot be negative/);
  });

  it("says nothing when no guarantee has been typed yet", () => {
    expect(choiceTallyError({ "1": "90" }, null, entree)).toBeNull();
  });
});
