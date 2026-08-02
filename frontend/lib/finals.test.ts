import { entreeTallyError, entreeTallyTotal, finalsPill, offeredEntreeIds } from "./finals";

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

describe("entreeTallyTotal", () => {
  it("adds the entered tallies", () => {
    expect(entreeTallyTotal({ "1": "90", "2": "60" })).toBe(150);
  });

  it("treats blank and junk as zero", () => {
    expect(entreeTallyTotal({ "1": "90", "2": "", "3": "abc" })).toBe(90);
  });
});

describe("entreeTallyError", () => {
  it("passes when the tallies hit the guarantee", () => {  // AC7
    expect(entreeTallyError({ "1": "90", "2": "60" }, 150)).toBeNull();
  });

  it("blocks when they undershoot", () => {  // AC7
    expect(entreeTallyError({ "1": "90", "2": "55" }, 150)).toMatch(/add up to the final guarantee \(150\)/);
    expect(entreeTallyError({ "1": "90", "2": "55" }, 150)).toMatch(/currently total 145/);
  });

  it("blocks when they overshoot", () => {  // AC7
    expect(entreeTallyError({ "1": "100", "2": "60" }, 150)).toMatch(/currently total 160/);
  });

  it("blocks while a tally is still blank", () => {  // AC7
    expect(entreeTallyError({ "1": "150", "2": "" }, 150)).toBeNull();
    expect(entreeTallyError({ "1": "140", "2": "" }, 150)).not.toBeNull();
  });

  it("says nothing when no guarantee has been typed yet", () => {
    expect(entreeTallyError({ "1": "90" }, null)).toBeNull();
  });
});

describe("offeredEntreeIds", () => {
  it("returns the offered dish ids in a stable order", () => {
    expect(offeredEntreeIds({ "12": null, "3": 40 })).toEqual([3, 12]);
  });

  it("is empty when nothing is offered", () => {
    expect(offeredEntreeIds(undefined)).toEqual([]);
    expect(offeredEntreeIds({})).toEqual([]);
  });
});
