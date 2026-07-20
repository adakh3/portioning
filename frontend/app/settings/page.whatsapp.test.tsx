import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));
vi.mock("@/lib/useQueryState", () => ({
  useQueryState: () => ["integrations", vi.fn()],
}));

let mockSettings: Record<string, unknown>;
vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({ data: mockSettings, isLoading: false, mutate: vi.fn() }),
}));

// Heavy sibling panels are irrelevant to the Integrations tab under test.
vi.mock("@/components/LeadStatusesSettings", () => ({ default: () => null }));
vi.mock("@/components/ChoiceOptionsSettings", () => ({ default: () => null }));
vi.mock("@/components/ProductLinesSettings", () => ({ default: () => null }));
vi.mock("@/components/CommissionSettings", () => ({ default: () => null }));
vi.mock("@/components/BillingPanel", () => ({ default: () => null }));

const updateSiteSettings = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api", () => ({
  api: { updateSiteSettings: (p: unknown) => updateSiteSettings(p) },
}));

import SettingsPage from "./page";

const BASE = {
  currency_symbol: "£",
  currency_code: "GBP",
  date_format: "DD/MM/YYYY",
  time_format: "24h",
  timezone: "Europe/London",
  tax_label: "VAT",
  default_tax_rate: "0.2000",
  default_price_per_head: "",
  default_guest_profile: "gents",
  target_food_cost_percentage: "",
  price_rounding_step: "50",
  quotation_terms: "",
  ai_followups_enabled: false,
};

describe("Settings → Integrations → AI follow-ups auto-generate", () => {
  beforeEach(() => updateSiteSettings.mockClear());

  it("includes followup_auto_generate in the AI settings save payload", async () => {
    mockSettings = {
      ...BASE,
      twilio_configured: false,
      ai_followups_enabled: true,
      followup_auto_generate: true,
    };
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle auto-generate follow-ups" }));
    fireEvent.click(screen.getByRole("button", { name: /Save AI follow-up settings|Save/i }));
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalled());
    const payload = updateSiteSettings.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.followup_auto_generate).toBe(false);
    expect(payload.ai_followups_enabled).toBe(true);
  });
});

describe("Settings → Integrations → WhatsApp shortcuts toggle", () => {
  beforeEach(() => updateSiteSettings.mockClear());

  it("saves whatsapp_shortcuts_enabled=false when toggled off", async () => {
    mockSettings = { ...BASE, twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<SettingsPage />);
    const row = screen.getByText("WhatsApp shortcuts").closest("div")!.parentElement!;
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() =>
      expect(updateSiteSettings).toHaveBeenCalledWith({ whatsapp_shortcuts_enabled: false }),
    );
  });

  it("saves whatsapp_shortcuts_enabled=true when toggled back on", async () => {
    mockSettings = { ...BASE, twilio_configured: false, whatsapp_shortcuts_enabled: false };
    render(<SettingsPage />);
    const row = screen.getByText("WhatsApp shortcuts").closest("div")!.parentElement!;
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() =>
      expect(updateSiteSettings).toHaveBeenCalledWith({ whatsapp_shortcuts_enabled: true }),
    );
  });

  it("shows the shortcuts toggle even without Twilio connected", () => {
    mockSettings = { ...BASE, twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<SettingsPage />);
    expect(screen.getByText("WhatsApp shortcuts")).toBeTruthy();
    expect(screen.getByText(/has not been set up/)).toBeTruthy();
  });
});
