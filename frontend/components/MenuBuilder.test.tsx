import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
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

  it("auto-fills price without an infinite update loop", async () => {
    h.priceEstimate.mockResolvedValue({ price_per_head: 1650, has_unpriced: true });

    // Reproduces the real parent: onPricePerHeadChange is a fresh closure each
    // render and setState always builds a NEW object, so an unguarded auto-fill
    // effect would re-fire forever ("Maximum update depth exceeded").
    let renderCount = 0;
    function Harness() {
      renderCount++;
      if (renderCount > 80) throw new Error(`render loop: ${renderCount} renders`);
      const [data, setData] = useState<{ price: string }>({ price: "" });
      return (
        <MenuBuilder
          selectedDishIds={[1]}
          basedOnTemplate={null}
          guestCount={100}
          priceRoundingStep={50}
          pricePerHead={data.price}
          onPricePerHeadChange={(val) => setData((prev) => ({ ...prev, price: val }))}
        />
      );
    }

    render(<Harness />);

    // Settles on the computed value (no thrown render-loop error).
    expect(await screen.findByDisplayValue("1650.00", undefined, { timeout: 3000 })).toBeInTheDocument();
    // Stays settled — the effect doesn't keep re-firing.
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByDisplayValue("1650.00")).toBeInTheDocument();
  });
});
