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
  event_type: "Wedding",
  meal_type: "Dinner",
  service_style: "Buffet",
  menu: [{ category: "Mains", items: ["Biryani", "Karahi"] }],
  line_items: [{ description: "Chair rental", category: "Rental", quantity: "120", unit: "Each", line_total: "600.00" }],
  price_per_head: "50.00",
  subtotal: "6600.00",
  tax_amount: "660.00",
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
