import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ createVenue: vi.fn(), mutate: vi.fn() }));

vi.mock("@/lib/hooks", () => ({
  useVenues: () => ({ data: [{ id: 1, name: "Grand Hall", city: "London" }], mutate: h.mutate }),
}));
vi.mock("@/lib/api", () => ({ api: { createVenue: h.createVenue } }));

import VenueField from "./VenueField";

describe("VenueField", () => {
  beforeEach(() => { h.createVenue.mockReset(); h.mutate.mockReset(); });

  it("defaults to address mode and edits the freeform address", () => {
    const onAddress = vi.fn();
    render(<VenueField venue="" address="" onVenue={vi.fn()} onAddress={onAddress} />);
    fireEvent.change(screen.getByPlaceholderText(/Oak Lane/), { target: { value: "Customer home" } });
    expect(onAddress).toHaveBeenCalledWith("Customer home");
  });

  it("clears the saved venue when switching to address mode", () => {
    const onVenue = vi.fn();
    render(<VenueField venue="1" address="" onVenue={onVenue} onAddress={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Address/));
    expect(onVenue).toHaveBeenCalledWith("");
  });

  it("creates a venue inline and selects it", async () => {
    h.createVenue.mockResolvedValue({ id: 9, name: "New Venue", city: "Leeds" });
    const onVenue = vi.fn();
    render(<VenueField venue="" address="" onVenue={onVenue} onAddress={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Saved venue/));
    fireEvent.click(screen.getByText("+ New venue"));
    fireEvent.change(screen.getByPlaceholderText("Venue name *"), { target: { value: "New Venue" } });
    fireEvent.click(screen.getByText("Add venue"));
    await waitFor(() => expect(h.createVenue).toHaveBeenCalledWith({ name: "New Venue", city: "" }));
    await waitFor(() => expect(onVenue).toHaveBeenCalledWith("9"));
  });
});
