import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Hoisted so the vi.mock factories can reference the spies.
const h = vi.hoisted(() => ({
  priceEstimate: vi.fn(),
}));

vi.mock("@/lib/hooks", () => ({
  useDishes: () => ({ data: [{ id: 1, name: "Biryani", category: 1, is_vegetarian: false }] }),
  useCategories: () => ({ data: [{ id: 1, display_name: "Mains", display_order: 1 }] }),
  useMenus: () => ({ data: [], isLoading: false }),
}));

// Keep the real collectErrorMessages; only stub the network methods.
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { priceEstimate: h.priceEstimate },
  };
});

import MenuBuilder from "./MenuBuilder";

describe("MenuBuilder — price errors are surfaced", () => {
  beforeEach(() => h.priceEstimate.mockReset());

  it("surfaces the server error (not silence) with a Retry that recovers", async () => {
    // First (auto) calc rejects; the Retry click succeeds.
    h.priceEstimate
      .mockRejectedValueOnce(new Error("Calculation error: boom"))
      .mockResolvedValueOnce({ price_per_head: 2000, has_unpriced: false });

    render(
      <MenuBuilder selectedDishIds={[1]} basedOnTemplate={null} guestCount={100} priceRoundingStep={50} />
    );

    // The debounced auto-calc fires priceEstimate, which rejects — and the
    // error is shown instead of being swallowed.
    expect(await screen.findByText("Calculation error: boom", undefined, { timeout: 3000 })).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /retry/i });

    // Retry succeeds → error clears and the computed rate appears.
    fireEvent.click(retry);
    await waitFor(() =>
      expect(screen.queryByText("Calculation error: boom")).not.toBeInTheDocument()
    );
    expect(await screen.findByText(/\/head/)).toBeInTheDocument();
  });
});
