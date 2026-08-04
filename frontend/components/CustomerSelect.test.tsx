import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  mutate: vi.fn(),
  contacts: [] as { id: number; name: string; phone: string }[],
}));

vi.mock("@/lib/hooks", () => ({
  useContacts: () => ({ data: h.contacts, mutate: h.mutate }),
}));

vi.mock("@/lib/api", () => ({
  api: { createCustomer: h.createCustomer },
}));

import CustomerSelect from "./CustomerSelect";

describe("CustomerSelect — inline create", () => {
  beforeEach(() => {
    h.createCustomer.mockReset();
    h.mutate.mockReset();
    h.contacts = [];
  });

  it("creates a new customer inline and selects it", async () => {
    h.createCustomer.mockResolvedValue({ id: 42, name: "New Person", phone: "123" });
    const onChange = vi.fn();
    render(<CustomerSelect value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("+ New customer"));
    fireEvent.change(screen.getByPlaceholderText("First name *"), { target: { value: "New" } });
    fireEvent.change(screen.getByPlaceholderText("Last name"), { target: { value: "Person" } });
    fireEvent.click(screen.getByText("Add customer"));

    await waitFor(() => expect(h.createCustomer).toHaveBeenCalledWith({ first_name: "New", last_name: "Person", phone: "", address: "" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("42"));
    expect(h.mutate).toHaveBeenCalled(); // refreshes the list so the option appears
  });

  it("requires a name", async () => {
    const onChange = vi.fn();
    render(<CustomerSelect value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("+ New customer"));
    fireEvent.click(screen.getByText("Add customer"));
    expect(await screen.findByText("First name is required")).toBeInTheDocument();
    expect(h.createCustomer).not.toHaveBeenCalled();
  });
});

describe("CustomerSelect — searching a list that only grows", () => {
  beforeEach(() => {
    h.contacts = [
      { id: 1, name: "Aisha Khan", phone: "+14155552000" },
      { id: 2, name: "Ben Carter", phone: "+14155551111" },
      { id: 3, name: "Aisha Khan", phone: "+14155553333" },
    ];
  });

  const open = () => fireEvent.click(screen.getByLabelText("Customer"));
  const type = (t: string) =>
    fireEvent.change(screen.getByLabelText("Search customer"), { target: { value: t } });
  const listed = () =>
    within(screen.getByRole("listbox")).getAllByRole("option")
      .map((b) => b.textContent).filter((t) => !t?.includes("Select customer"));

  it("filters by name", () => {
    render(<CustomerSelect value="" onChange={vi.fn()} />);
    open();
    type("ben");
    expect(listed()).toHaveLength(1);
    expect(listed()[0]).toContain("Ben Carter");
  });

  it("filters by phone, which is how a caller is often identified", () => {
    // Two customers are both "Aisha Khan" — the number is the only way to say
    // which one, so it has to be searchable, not just displayed.
    render(<CustomerSelect value="" onChange={vi.fn()} />);
    open();
    type("5553333");
    expect(listed()).toEqual(["Aisha Khan+14155553333"]);
  });

  it("reports the chosen customer's id", () => {
    const onChange = vi.fn();
    render(<CustomerSelect value="" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByText("Ben Carter"));
    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("shows the selected customer's name once chosen", () => {
    render(<CustomerSelect value="2" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Customer")).toHaveTextContent("Ben Carter");
  });
});
