import { render, screen } from "@testing-library/react";
import FinalsPill from "./FinalsPill";

/** REL-419 AC4/AC5/AC6 — the same pill renders on the event page and the events
 * list, so these assertions cover both surfaces. */
describe("FinalsPill", () => {
  it("shows an amber 'Finals due <date>' as the date approaches", () => {  // AC4
    render(<FinalsPill status="due_soon" dueDate="2026-08-10" dateFormat="MM/DD/YYYY" />);
    const pill = screen.getByTestId("finals-pill");
    expect(pill).toHaveTextContent("Finals due 08/10/2026");
    expect(pill.className).toContain("bg-amber-100");
    expect(pill.className).toContain("text-amber-700");
  });

  it("turns red once the date has passed", () => {  // AC5
    render(<FinalsPill status="overdue" dueDate="2026-07-01" dateFormat="MM/DD/YYYY" />);
    const pill = screen.getByTestId("finals-pill");
    expect(pill).toHaveTextContent("Finals overdue 07/01/2026");
    expect(pill.className).toContain("bg-red-100");
  });

  it("turns green once the numbers are recorded", () => {  // AC6
    render(<FinalsPill status="recorded" dueDate="2026-07-01" dateFormat="MM/DD/YYYY" />);
    const pill = screen.getByTestId("finals-pill");
    expect(pill).toHaveTextContent("Finals recorded");
    expect(pill).not.toHaveTextContent("07/01/2026");
    expect(pill.className).toContain("bg-green-100");
  });

  it("renders nothing when there is no finals state", () => {
    const { container } = render(<FinalsPill status={null} dueDate={null} dateFormat="MM/DD/YYYY" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("respects the org's date format", () => {
    render(<FinalsPill status="due_soon" dueDate="2026-08-10" dateFormat="DD/MM/YYYY" />);
    expect(screen.getByTestId("finals-pill")).toHaveTextContent("Finals due 10/08/2026");
  });
});
