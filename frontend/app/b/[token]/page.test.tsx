import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PublicBooking } from "@/lib/api";

// Integration test for the client-facing sign page: render the REAL page, drive
// the sign form through the UI, and assert the payload sent to signPublicBooking
// + that the signed confirmation renders.
const h = vi.hoisted(() => ({ getPublicBooking: vi.fn(), signPublicBooking: vi.fn() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: "tok-123" }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getPublicBooking: h.getPublicBooking,
    signPublicBooking: h.signPublicBooking,
    publicBookingPdfUrl: (t: string) => `/api/public/bookings/${t}/pdf/`,
  },
}));

import PublicBookingSignPage from "./page";

const booking: PublicBooking = {
  kind: "quote",
  reference: "Quote #42",
  business_name: "Spice Route Catering",
  currency_symbol: "$",
  currency_code: "USD",
  tax_label: "Sales Tax",
  terms: "Deposit due on booking.",
  customer_name: "Aisha Khan",
  event_date: "2026-09-01",
  venue_name: "Grand Hall",
  venue_address: "",
  guest_count: 120,
  gents: 60,
  ladies: 60,
  event_type: "wedding",
  event_type_label: "Wedding",
  meal_type: "dinner",
  meal_type_label: "Dinner",
  service_style: "buffet",
  service_style_label: "Buffet",
  timeline: [{ label: "Meal service", time: "2026-09-01T18:00:00Z" }],
  menu: [{ category: "Mains", items: ["Biryani", "Karahi"] }],
  additional_meals: [{ label: "Drivers food", guest_count: 25, price_per_head: "4350.00", items: ["Chicken Biryani"] }],
  line_items: [{ description: "Chair rental", category: "Rental", quantity: "120", unit: "Each", line_total: "600.00" }],
  price_per_head: "50.00",
  subtotal: "6600.00",
  tax_rate: "0.2000",
  tax_amount: "660.00",
  service_charge_pct: "0.00",
  service_charge_taxable: true,
  service_charge: "0.00",
  gratuity_pct: "0.00",
  gratuity: "0.00",
  total: "7260.00",
  notes: "",
  status: "sent",
  is_signed: false,
  signable: true,
  signer_name: null,
  signed_at: null,
};

describe("Public booking sign page", () => {
  beforeEach(() => {
    h.getPublicBooking.mockReset();
    h.signPublicBooking.mockReset();
  });

  it("renders the booking and signs with name + consent", async () => {
    h.getPublicBooking.mockResolvedValue(booking);
    h.signPublicBooking.mockResolvedValue({
      ...booking, is_signed: true, signable: false, signer_name: "Aisha Khan", signed_at: "2026-07-06T10:00:00Z",
    });

    render(<PublicBookingSignPage />);

    // Booking details render
    await screen.findByText("Quote #42");
    expect(screen.getByText("Spice Route Catering")).toBeInTheDocument();
    expect(screen.getByText("Biryani")).toBeInTheDocument();
    expect(screen.getByText("Drivers food")).toBeInTheDocument(); // additional meal shown
    expect(screen.getByText("Wedding")).toBeInTheDocument(); // resolved type label, not "wedding"
    expect(screen.getByText("Meal service")).toBeInTheDocument(); // timeline shown
    expect(screen.getByText("$7260.00")).toBeInTheDocument();

    // Cannot submit without name + consent
    const submit = screen.getByRole("button", { name: /accept & sign/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Aisha Khan" } });
    fireEvent.click(screen.getByLabelText("I agree to the terms"));
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await waitFor(() => expect(h.signPublicBooking).toHaveBeenCalledTimes(1));
    expect(h.signPublicBooking).toHaveBeenCalledWith("tok-123", expect.objectContaining({
      signer_name: "Aisha Khan",
      consent: true,
    }));

    // Signed confirmation replaces the form
    await screen.findByText(/accepted & signed/i);
    expect(screen.getByText(/Signed by Aisha Khan/)).toBeInTheDocument();
  });

  it("shows the service-charge and gratuity rows when they are non-zero", async () => {
    // The client's contract must display what they're agreeing to pay. $6,600
    // subtotal, 20% taxable SC ($1,320), tax on $7,920 = $1,584, 15% gratuity
    // ($990) → total $10,494.
    h.getPublicBooking.mockResolvedValue({
      ...booking,
      service_charge_pct: "20.00", service_charge: "1320.00",
      tax_amount: "1584.00",
      gratuity_pct: "15.00", gratuity: "990.00",
      total: "10494.00",
    });

    render(<PublicBookingSignPage />);

    await screen.findByText("Quote #42");
    expect(screen.getByText("Service charge (20%)")).toBeInTheDocument();
    expect(screen.getByText("$1320.00")).toBeInTheDocument();
    expect(screen.getByText("Gratuity (15%)")).toBeInTheDocument();
    expect(screen.getByText("$990.00")).toBeInTheDocument();
    expect(screen.getByText("$10494.00")).toBeInTheDocument(); // grand total
  });

  it("renders terms in a collapsible section with markdown stripped", async () => {
    h.getPublicBooking.mockResolvedValue({
      ...booking,
      terms: "# Service Agreement\n\n**Effective Date:** [Date]\n\n## 1. Booking\n- A deposit is required.",
    });
    render(<PublicBookingSignPage />);

    // Collapsible <details> with a summary the client can expand.
    await screen.findByText("Terms & Conditions");
    const details = screen.getByText("Terms & Conditions").closest("details");
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute("open"); // collapsed by default

    // Markdown markers are stripped — no raw "##" heading or "**" bold syntax.
    expect(screen.getByText("1. Booking")).toBeInTheDocument();
    expect(screen.getByText(/Effective Date:/)).toBeInTheDocument();
    expect(screen.queryByText(/##/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("shows an error state for an invalid link", async () => {
    h.getPublicBooking.mockRejectedValue(new Error("Not found"));
    render(<PublicBookingSignPage />);
    await screen.findByText(/isn.t available/i);
  });

  it("hides the sign form when the booking is already signed", async () => {
    h.getPublicBooking.mockResolvedValue({
      ...booking, is_signed: true, signable: false, signer_name: "Aisha Khan", signed_at: "2026-07-06T10:00:00Z",
    });
    render(<PublicBookingSignPage />);
    await screen.findByText(/accepted & signed/i);
    expect(screen.queryByRole("button", { name: /accept & sign/i })).not.toBeInTheDocument();
  });
});
