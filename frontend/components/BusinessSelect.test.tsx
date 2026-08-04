import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createAccount: vi.fn(),
  mutate: vi.fn(),
  accounts: [] as { id: number; name: string; account_type: string }[],
}));

vi.mock("@/lib/hooks", () => ({
  useAccounts: () => ({ data: h.accounts, mutate: h.mutate }),
}));

vi.mock("@/lib/api", () => ({
  api: { createAccount: h.createAccount },
}));

import BusinessSelect from "./BusinessSelect";

const open = () => fireEvent.click(screen.getByLabelText("Business"));
const listed = () =>
  within(screen.getByRole("listbox")).getAllByRole("option")
    .map((b) => b.textContent).filter((t) => !t?.includes("Select business"));

describe("BusinessSelect", () => {
  beforeEach(() => {
    h.createAccount.mockReset();
    h.mutate.mockReset();
    h.accounts = [
      { id: 1, name: "Northwind Trading", account_type: "company" },
      { id: 2, name: "Jane Doe", account_type: "individual" },
      { id: 3, name: "Northwind Events", account_type: "agency" },
      { id: 4, name: "The Old Hall", account_type: "venue" },
    ];
  });

  it("lists real businesses only — an individual is not a company", () => {
    render(<BusinessSelect value="" onChange={vi.fn()} />);
    open();
    expect(listed()).toEqual(["Northwind Trading", "Northwind Events", "The Old Hall"]);
  });

  it("filters as you type", () => {
    render(<BusinessSelect value="" onChange={vi.fn()} />);
    open();
    fireEvent.change(screen.getByLabelText("Search business"), { target: { value: "northwind" } });
    expect(listed()).toEqual(["Northwind Trading", "Northwind Events"]);
  });

  it("reports the chosen business's id and then shows its name", () => {
    const onChange = vi.fn();
    const { rerender } = render(<BusinessSelect value="" onChange={onChange} />);
    open();
    fireEvent.click(screen.getByText("The Old Hall"));
    expect(onChange).toHaveBeenCalledWith("4");
    rerender(<BusinessSelect value="4" onChange={onChange} />);
    expect(screen.getByLabelText("Business")).toHaveTextContent("The Old Hall");
  });

  it("still creates a business inline and selects it", async () => {
    h.createAccount.mockResolvedValue({ id: 42, name: "Fresh Co" });
    const onChange = vi.fn();
    render(<BusinessSelect value="" onChange={onChange} />);

    fireEvent.click(screen.getByText("+ New business"));
    fireEvent.change(screen.getByPlaceholderText("Business name *"), { target: { value: "Fresh Co" } });
    fireEvent.click(screen.getByText("Add business"));

    await waitFor(() =>
      expect(h.createAccount).toHaveBeenCalledWith({ name: "Fresh Co", account_type: "company" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("42"));
    expect(h.mutate).toHaveBeenCalled();   // refreshes the list so the new row appears
  });

  it("requires a name to create one", async () => {
    render(<BusinessSelect value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByText("+ New business"));
    fireEvent.click(screen.getByText("Add business"));
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(h.createAccount).not.toHaveBeenCalled();
  });
});
