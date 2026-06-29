import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { Subscription } from "@/lib/api";

let searchParamsString = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsString),
}));

let mockUser: { id: number; role: string; is_superuser?: boolean } | null;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mockUser }) }));

let mockSub: Subscription | null;
let mockLoading = false;
vi.mock("@/lib/hooks", () => ({
  useSubscription: () => ({ data: mockSub, isLoading: mockLoading }),
}));

const startCheckout = vi.fn().mockResolvedValue({ url: "https://checkout.test/go" });
const openBillingPortal = vi.fn().mockResolvedValue({ url: "https://portal.test/go" });
vi.mock("@/lib/api", () => ({
  api: {
    startCheckout: () => startCheckout(),
    openBillingPortal: () => openBillingPortal(),
  },
}));

import BillingPage from "./page";

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    status: "trialing",
    plan_name: "",
    current_period_end: null,
    cancel_at_period_end: false,
    trial_ends_at: "2030-01-08T00:00:00Z",
    is_trialing: true,
    trial_days_remaining: 5,
    has_access: true,
    has_billing_account: false,
    ...overrides,
  };
}

beforeEach(() => {
  startCheckout.mockClear();
  openBillingPortal.mockClear();
  searchParamsString = "";
  mockLoading = false;
  // jsdom doesn't implement navigation; make href assignable + observable.
  Object.defineProperty(window, "location", {
    writable: true,
    value: { href: "" },
  });
});

describe("BillingPage", () => {
  it("shows trial days remaining", () => {
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({ trial_days_remaining: 5 });
    render(<BillingPage />);
    expect(screen.getByText(/5/)).toBeTruthy();
    expect(screen.getByText(/left in your free trial/i)).toBeTruthy();
    expect(screen.getByText("Free trial")).toBeTruthy();
  });

  it("new org can start the card-required free trial — redirects to checkout", async () => {
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({ status: "none", is_trialing: false, has_access: false });
    render(<BillingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start your free trial" }));
    await waitFor(() => expect(startCheckout).toHaveBeenCalled());
    await waitFor(() => expect(window.location.href).toBe("https://checkout.test/go"));
  });

  it("expired/canceled with a prior account prompts to Subscribe", () => {
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({
      status: "canceled",
      is_trialing: false,
      has_access: false,
      has_billing_account: true, // had a subscription before
    });
    render(<BillingPage />);
    // Returning customer subscribes (no second trial); can also manage billing.
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeTruthy();
  });

  it("active plan shows Manage billing and renewal date, no CTA", () => {
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({
      status: "active",
      is_trialing: false,
      plan_name: "Pro",
      current_period_end: "2030-02-01T00:00:00Z",
      has_billing_account: true,
    });
    render(<BillingPage />);
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText(/Renews on/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
  });

  it("during a card-on-file trial shows Manage billing + charge note, no CTA", () => {
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({ has_billing_account: true }); // Stripe-managed trial
    render(<BillingPage />);
    expect(screen.getByText(/left in your free trial/i)).toBeTruthy();
    expect(screen.getByText(/card will be charged when the trial ends/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start your free trial" })).toBeNull();
  });

  it("non-owner sees a read-only message, no buttons", () => {
    mockUser = { id: 2, role: "manager" };
    mockSub = makeSub({ status: "none", is_trialing: false, has_access: false });
    render(<BillingPage />);
    expect(screen.getByText(/Only the account owner can manage billing/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start your free trial" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
  });

  it("shows a success banner after returning from checkout", () => {
    searchParamsString = "status=success";
    mockUser = { id: 1, role: "owner" };
    mockSub = makeSub({ status: "active", is_trialing: false, has_billing_account: true });
    render(<BillingPage />);
    expect(screen.getByText(/all set/i)).toBeTruthy();
  });
});
