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

// Since REL-465 the card is handed the engine's own decimal STRINGS rather than
// parsed floats. Strings break the obvious `x !== 0` row guards ("0.00" is not 0),
// which is how an empty "Add-on items — $0.00" line would appear on every booking.
describe("BookingTotalsCard — the engine's strings, rendered as sent", () => {
  const base = {
    title: "Quote Total",
    currencySymbol: "$",
    foodLabel: "Food / Menu",
    taxLabel: "Sales Tax",
    taxPercent: "8.875",
  };

  it("formats decimal strings with thousand separators", () => {
    render(
      <BookingTotalsCard
        {...base}
        foodTotal="12345.60"
        addOnsTotal="300.00"
        subtotal="12645.60"
        serviceCharge="2529.12"
        taxAmount="1345.83"
        gratuity="632.28"
        total="17152.83"
      />,
    );
    expect(screen.getByText("$17,152.83")).toBeInTheDocument();
    expect(screen.getByText("$12,645.60")).toBeInTheDocument();
    expect(screen.getByText("$1,345.83")).toBeInTheDocument();
    expect(screen.getByText("Sales Tax (8.875%)")).toBeInTheDocument();
  });

  it("hides the add-on, service-charge and gratuity rows on a string zero", () => {
    render(
      <BookingTotalsCard
        {...base}
        foodTotal="1000.00"
        addOnsTotal="0.00"
        subtotal="1000.00"
        serviceCharge="0.00"
        taxAmount="0.00"
        gratuity="0.00"
        total="1000.00"
      />,
    );
    expect(screen.queryByText("Add-on items")).not.toBeInTheDocument();
    expect(screen.queryByText(/Service charge/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gratuity/)).not.toBeInTheDocument();
  });

  it("still shows a NEGATIVE add-on line — a discount is not nothing", () => {
    render(
      <BookingTotalsCard
        {...base}
        foodTotal="1000.00"
        addOnsTotal="-150.00"
        subtotal="850.00"
        taxAmount="0.00"
        total="850.00"
      />,
    );
    expect(screen.getByText("Add-on items")).toBeInTheDocument();
    expect(screen.getByText("$-150.00")).toBeInTheDocument();
  });

  it("renders itemized food rows carrying string rates", () => {
    render(
      <BookingTotalsCard
        {...base}
        foodTotal="4050.00"
        foodRows={[
          { name: "Adults", count: 80, rate: "45.00", amount: "3600.00" },
          { name: "Kids", count: 20, rate: "22.50", amount: "450.00" },
        ]}
        addOnsTotal="0.00"
        subtotal="4050.00"
        taxAmount="0.00"
        total="4050.00"
      />,
    );
    expect(screen.getByText("Adults — 80 × $45.00")).toBeInTheDocument();
    expect(screen.getByText("Kids — 20 × $22.50")).toBeInTheDocument();
    // The single food line gives way to the itemization.
    expect(screen.queryByText("Food / Menu")).not.toBeInTheDocument();
  });

  it("dims but never blanks while fresher figures are on their way", () => {
    const { container } = render(
      <BookingTotalsCard
        {...base}
        foodTotal="1000.00"
        addOnsTotal="0.00"
        subtotal="1000.00"
        taxAmount="0.00"
        total="1000.00"
        isStale
        staleHint="Totals will refresh shortly"
      />,
    );
    // The money is still on screen — that is the whole contract.
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Totals will refresh shortly")).toBeInTheDocument();
    expect(container.querySelector('[data-stale="true"]')).not.toBeNull();
  });

  it("is not marked stale, and says nothing, when the figures are current", () => {
    const { container } = render(
      <BookingTotalsCard
        {...base}
        foodTotal="1000.00"
        addOnsTotal="0.00"
        subtotal="1000.00"
        taxAmount="0.00"
        total="1000.00"
      />,
    );
    expect(container.querySelector('[data-stale="true"]')).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
