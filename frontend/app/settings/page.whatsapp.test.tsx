import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

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
// Shares the Integrations tab with WhatsApp but has its own hook and API calls;
// page.clientEmail.test.tsx is where it's exercised for real.
vi.mock("@/components/ClientEmailSettings", () => ({ default: () => null }));

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

  // REL-515 — the first-response toggle is independent of the follow-up dials
  // and rides the same Save.
  it("includes first_response_enabled in the AI settings save payload", async () => {
    mockSettings = {
      ...BASE,
      twilio_configured: false,
      ai_followups_enabled: true,
      first_response_enabled: false,
    };
    render(<SettingsPage />);
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle AI first response for new leads" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/i }));
    await waitFor(() => expect(updateSiteSettings).toHaveBeenCalled());
    const payload = updateSiteSettings.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(payload.first_response_enabled).toBe(true);
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

  // REL-445 — the default-channel picker moved into this card, and the whole
  // point of the card is that all three dials live in one place.
  it("saves the default channel the modal will preselect", async () => {
    mockSettings = { ...BASE, default_client_channel: "whatsapp" };
    render(<SettingsPage />);

    const picker = screen.getByLabelText("Default channel") as HTMLSelectElement;
    expect(picker.value).toBe("whatsapp");
    fireEvent.change(picker, { target: { value: "email" } });

    await waitFor(() =>
      expect(updateSiteSettings).toHaveBeenCalledWith({ default_client_channel: "email" }),
    );
  });

  it("keeps all three dials in one card, not three rival cards", () => {
    mockSettings = { ...BASE, twilio_configured: false };
    render(<SettingsPage />);
    expect(screen.getByText("Client communications")).toBeTruthy();
    expect(screen.getByTestId("settings-default-channel-row")).toBeTruthy();
    expect(screen.getByTestId("settings-email-row")).toBeTruthy();
    expect(screen.getByTestId("settings-whatsapp-row")).toBeTruthy();
    // The old standalone cards are gone, not merely hidden.
    expect(screen.queryByText("Client email")).toBeNull();
    expect(screen.queryByRole("heading", { name: /^WhatsApp$/ })).not.toBeNull();
  });

  it("shows the shortcuts toggle even without Twilio connected", () => {
    mockSettings = { ...BASE, twilio_configured: false, whatsapp_shortcuts_enabled: true };
    render(<SettingsPage />);
    expect(screen.getByText("WhatsApp shortcuts")).toBeTruthy();
    // REL-445 replaced "contact support" with the derived-capability wording:
    // no Twilio isn't a broken setup, it's the shortcut mechanism.
    const whatsappRow = within(screen.getByTestId("settings-whatsapp-row"));
    expect(whatsappRow.getByText("Shortcuts")).toBeTruthy();
    expect(whatsappRow.getByText(/Add a WhatsApp business number/)).toBeTruthy();
  });
});
