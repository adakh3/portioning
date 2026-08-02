import { render, screen, within } from "@testing-library/react";
import MenuAsClientSees from "./MenuAsClientSees";

/** REL-419 AC13 — the in-app view of the menu the client signs. The lines arrive
 * already rendered by the backend (`booking_menu_courses`, the same function behind
 * both PDFs and the sign page), so this component must display them verbatim and
 * never re-format — that is what keeps the app and the contract identical. */
describe("MenuAsClientSees", () => {
  it("renders the server's lines verbatim, course by course", () => {
    render(
      <MenuAsClientSees
        menuLines={[
          { name: "Entrée", items: ["Choice of: Filet Mignon / Salmon / Vegetarian", "Mashed Potatoes"] },
          { name: "Dessert", items: ["New York Cheesecake"] },
        ]}
      />,
    );
    const card = screen.getByTestId("menu-as-client-sees");
    expect(within(card).getByText("Entrée")).toBeInTheDocument();
    expect(
      within(card).getByText("Choice of: Filet Mignon / Salmon / Vegetarian"),
    ).toBeInTheDocument();
    // The unflagged dish in the same course keeps its own line (AC12).
    expect(within(card).getByText("Mashed Potatoes")).toBeInTheDocument();
    expect(within(card).getByText("New York Cheesecake")).toBeInTheDocument();
  });

  it("labels the unassigned group the way the documents do", () => {
    render(<MenuAsClientSees menuLines={[{ name: "", items: ["Dinner Rolls"] }]} />);
    expect(screen.getByText("Additional dishes")).toBeInTheDocument();
  });

  it("renders nothing when the booking has no courses", () => {
    // Course-less bookings show the flat menu above; this card would be noise.
    const { container } = render(<MenuAsClientSees menuLines={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an empty list or a missing field", () => {
    expect(render(<MenuAsClientSees menuLines={[]} />).container).toBeEmptyDOMElement();
    expect(render(<MenuAsClientSees menuLines={undefined} />).container).toBeEmptyDOMElement();
  });
});
