import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * The customer form now carries a title (REL-479), because messages address
 * people better when they have one — 'Hello Ms Rizvi,' rather than by first
 * name, and never by a company's first word.
 *
 * Page-level rather than unit-level on purpose: the repo rule exists because
 * the field -> state -> payload wiring is where these bugs actually live.
 */
const h = vi.hoisted(() => ({
  contacts: vi.fn(),
  accounts: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useContacts: () => h.contacts(),
  useAccounts: () => h.accounts(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    createCustomer: (...a: unknown[]) => h.create(...a),
    updateCustomer: (...a: unknown[]) => h.update(...a),
  },
}));

import CustomersPage from "./page";

const EXISTING = {
  id: 7, name: "Batool Rizvi", title: "Ms", first_name: "Batool", last_name: "Rizvi",
  email: "b@example.com", phone: "+447700900123", address: "", account: null,
  role: "coordinator", is_primary: true, notes: "", created_at: "", updated_at: "",
};

beforeEach(() => {
  h.contacts.mockReset().mockReturnValue({ data: [], isLoading: false, mutate: vi.fn() });
  h.accounts.mockReset().mockReturnValue({ data: [] });
  h.create.mockReset().mockResolvedValue({ id: 1 });
  h.update.mockReset().mockResolvedValue({ id: 7 });
});

describe("Customer form — title", () => {
  it("sends the chosen title when creating", async () => {
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: /new customer/i }));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dr" } });
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Amara" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Nwosu" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0]).toMatchObject({
      title: "Dr", first_name: "Amara", last_name: "Nwosu",
    });
  });

  it("leaves the title empty when it wasn't chosen, rather than guessing one", async () => {
    // Inferring 'Mr'/'Ms' from a name is exactly what the drafting rule forbids.
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: /new customer/i }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0]).toMatchObject({ title: "" });
  });

  it("loads an existing title into the form and saves a change to it", async () => {
    h.contacts.mockReturnValue({ data: [EXISTING], isLoading: false, mutate: vi.fn() });
    render(<CustomersPage />);

    fireEvent.click(screen.getByText("Batool Rizvi"));
    const title = screen.getByLabelText("Title") as HTMLSelectElement;
    expect(title.value).toBe("Ms");

    fireEvent.change(title, { target: { value: "Prof" } });
    fireEvent.click(screen.getByRole("button", { name: /save customer/i }));

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0]).toBe(7);
    expect(h.update.mock.calls[0][1]).toMatchObject({ title: "Prof" });
  });

  it("does not stretch the title select across the name row", () => {
    // Caught by hand on production, not by the payload tests above. Appending a
    // width to a class that already carries `w-full` does not override it —
    // Tailwind emits both and stylesheet order wins — so the select went
    // full-width and pushed First/Last across the Phone column.
    render(<CustomersPage />);
    fireEvent.click(screen.getByRole("button", { name: /new customer/i }));

    const title = screen.getByLabelText("Title");
    expect(title.className).not.toContain("w-full");
    expect(title.className).toContain("shrink-0");
  });
});
