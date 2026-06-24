import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BookingTotalsCard from "./BookingTotalsCard";

describe("BookingTotalsCard", () => {
  it("renders the food, add-on, subtotal, tax and total rows", () => {
    render(
      <BookingTotalsCard
        title="Quote Total"
        currencySymbol="£"
        foodTotal={5000}
        foodLabel="Food / Menu (£50/head × 100 guests)"
        addOnsTotal={300}
        subtotal={5300}
        taxAmount={1060}
        total={6360}
        taxLabel="VAT"
        taxPercent="20"
      />,
    );
    expect(screen.getByText("Quote Total")).toBeInTheDocument();
    expect(screen.getByText("Food / Menu (£50/head × 100 guests)")).toBeInTheDocument();
    expect(screen.getByText("Add-on items")).toBeInTheDocument();
    expect(screen.getByText("VAT (20%)")).toBeInTheDocument();
    expect(screen.getByText("£6,360.00")).toBeInTheDocument();
  });

  it("renders meal rows (event flavour)", () => {
    render(
      <BookingTotalsCard
        title="Pricing"
        currencySymbol="£"
        foodTotal={1000}
        foodLabel="Food (£50/head × 20 guests)"
        meals={[{ label: "Sehri (£15/head × 20)", total: 300 }]}
        addOnsTotal={0}
        subtotal={1300}
        taxAmount={0}
        total={1300}
        taxLabel="VAT"
        taxPercent="0"
      />,
    );
    expect(screen.getByText("Sehri (£15/head × 20)")).toBeInTheDocument();
    // addOnsTotal 0 -> the add-on row is hidden
    expect(screen.queryByText("Add-on items")).not.toBeInTheDocument();
  });

  it("shows 'not applied' and a dash when tax is not applied", () => {
    render(
      <BookingTotalsCard
        title="Pricing"
        currencySymbol="£"
        foodTotal={1000}
        foodLabel="Food"
        addOnsTotal={0}
        subtotal={1000}
        taxAmount={0}
        total={1000}
        taxLabel="VAT"
        taxPercent="20"
        taxApplied={false}
      />,
    );
    expect(screen.getByText(/not applied/)).toBeInTheDocument();
  });
});
