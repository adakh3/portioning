import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useContacts: () => ({ data: [], mutate: h.mutate }),
}));

vi.mock("@/lib/api", () => ({
  api: { createCustomer: h.createCustomer },
}));

import CustomerSelect from "./CustomerSelect";

describe("CustomerSelect — inline create", () => {
  beforeEach(() => {
    h.createCustomer.mockReset();
    h.mutate.mockReset();
  });

  it("creates a new customer inline and selects it", async () => {
    h.createCustomer.mockResolvedValue({ id: 42, name: "New Person", phone: "123" });
    const onChange = vi.fn();
    render(<CustomerSelect value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("+ New customer"));
    fireEvent.change(screen.getByPlaceholderText("Name *"), { target: { value: "New Person" } });
    fireEvent.click(screen.getByText("Add customer"));

    await waitFor(() => expect(h.createCustomer).toHaveBeenCalledWith({ name: "New Person", phone: "", address: "" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("42"));
    expect(h.mutate).toHaveBeenCalled(); // refreshes the list so the option appears
  });

  it("requires a name", async () => {
    const onChange = vi.fn();
    render(<CustomerSelect value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("+ New customer"));
    fireEvent.click(screen.getByText("Add customer"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(h.createCustomer).not.toHaveBeenCalled();
  });
});
