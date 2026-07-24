// DELIBERATE FAILURE — proves the frontend required check goes red (REL-360 AC2).
// Throwaway; never merged.
describe("ci drill", () => {
  it("fails on purpose", () => {
    expect(1).toBe(2);
  });
});
