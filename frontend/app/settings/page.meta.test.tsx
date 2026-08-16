import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import type { MetaStatus, MetaAvailablePage } from "@/lib/api";

// REL-506 — the "Facebook & Instagram" card on Settings → Integrations. Driven
// through the real page, so the failures this pins are wiring ones: the card
// showing when the launch flag is off, not reaching the right endpoint, not
// navigating to the Meta consent URL, or not posting the picked Page ids.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));
vi.mock("@/lib/useQueryState", () => ({
  useQueryState: () => ["integrations", vi.fn()],
}));

// A mutable settings object so a single test can flip the launch flag off. One
// stable reference per test — a fresh `{}` per call re-fires the effect forever.
let mockSettings: Record<string, unknown>;
let mockMeta: MetaStatus;
const mutateMeta = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({ data: mockSettings, isLoading: false, mutate: vi.fn() }),
  useMetaStatus: () => ({ data: mockMeta, isLoading: false, mutate: mutateMeta }),
}));

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const startMetaConnect = vi.fn();
const getMetaPages = vi.fn();
const connectMetaPages = vi.fn();
const disconnectMetaPage = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    updateSiteSettings: vi.fn(),
    startMetaConnect: () => startMetaConnect(),
    getMetaPages: () => getMetaPages(),
    connectMetaPages: (ids: string[]) => connectMetaPages(ids),
    disconnectMetaPage: (id: string) => disconnectMetaPage(id),
  },
}));

// Sibling panels on the integrations tab (and others) pull their own hooks.
vi.mock("@/components/ClientCommunicationsSettings", () => ({ default: () => null }));
vi.mock("@/components/LeadStatusesSettings", () => ({ default: () => null }));
vi.mock("@/components/ChoiceOptionsSettings", () => ({ default: () => null }));
vi.mock("@/components/ProductLinesSettings", () => ({ default: () => null }));
vi.mock("@/components/CommissionSettings", () => ({ default: () => null }));
vi.mock("@/components/BillingPanel", () => ({ default: () => null }));

import SettingsPage from "./page";

const NOT_AUTHORIZED: MetaStatus = { app_configured: true, authorized: false, pages: [] };
const AUTHORIZED_NO_PAGES: MetaStatus = { app_configured: true, authorized: true, pages: [] };
const CONNECTED: MetaStatus = {
  app_configured: true,
  authorized: true,
  pages: [{
    id: 1, page_id: "PAGE1", page_name: "Acme Catering",
    instagram_account_id: "IG1", instagram_username: "acme_ig",
    created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z",
  }],
};

const AVAILABLE_BOTH: MetaAvailablePage[] = [
  { page_id: "PAGE1", page_name: "Acme Catering", instagram_account_id: "IG1", instagram_username: "acme_ig", connected: false },
  { page_id: "PAGE2", page_name: "Acme Events", instagram_account_id: "", instagram_username: "", connected: false },
];
const AVAILABLE_ONE_CONNECTED: MetaAvailablePage[] = [
  { page_id: "PAGE1", page_name: "Acme Catering", instagram_account_id: "IG1", instagram_username: "acme_ig", connected: true },
  { page_id: "PAGE2", page_name: "Acme Events", instagram_account_id: "", instagram_username: "", connected: false },
];

function card() {
  return within(screen.getByTestId("settings-meta-card"));
}

function stubNavigation() {
  const location = { href: "" };
  Object.defineProperty(window, "location", { value: location, writable: true, configurable: true });
  return location;
}

beforeEach(() => {
  startMetaConnect.mockReset().mockResolvedValue({ auth_url: "https://www.facebook.com/consent" });
  getMetaPages.mockReset().mockResolvedValue(AVAILABLE_BOTH);
  connectMetaPages.mockReset().mockResolvedValue({ pages: [], errors: [] });
  disconnectMetaPage.mockReset().mockResolvedValue(undefined);
  mutateMeta.mockClear();
  mockSearchParams = new URLSearchParams();
  mockSettings = { currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY", meta_leads_enabled: true };
  mockMeta = NOT_AUTHORIZED;
});

describe("Settings → Integrations → Facebook & Instagram", () => {
  it("is hidden entirely when the launch flag is off (AC1)", () => {
    mockSettings = { ...mockSettings, meta_leads_enabled: false };
    render(<SettingsPage />);
    expect(screen.queryByTestId("settings-meta-card")).toBeNull();
  });

  it("shows a Connect button when the flag is on and nothing is connected (AC2)", () => {
    render(<SettingsPage />);
    expect(card().getByText("Not connected")).toBeTruthy();
    expect(card().getByRole("button", { name: /Connect Facebook & Instagram/ })).toBeTruthy();
  });

  it("sends the browser to the Meta consent URL the backend returns", async () => {
    const location = stubNavigation();
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: /Connect Facebook & Instagram/ }));

    await waitFor(() => expect(startMetaConnect).toHaveBeenCalled());
    await waitFor(() => expect(location.href).toBe("https://www.facebook.com/consent"));
  });

  it("lists the admin's Pages to pick from once authorised (AC3)", async () => {
    mockMeta = AUTHORIZED_NO_PAGES;
    render(<SettingsPage />);

    await waitFor(() => expect(getMetaPages).toHaveBeenCalled());
    expect(await card().findByText("Choose Pages to connect")).toBeTruthy();
    expect(card().getByRole("checkbox", { name: /Acme Catering/ })).toBeTruthy();
    expect(card().getByRole("checkbox", { name: /Acme Events/ })).toBeTruthy();
  });

  it("connects only the selected Pages (AC3)", async () => {
    mockMeta = AUTHORIZED_NO_PAGES;
    render(<SettingsPage />);

    const checkbox = await card().findByRole("checkbox", { name: /Acme Catering/ });
    fireEvent.click(checkbox);
    fireEvent.click(card().getByRole("button", { name: "Connect selected Pages" }));

    await waitFor(() => expect(connectMetaPages).toHaveBeenCalledWith(["PAGE1"]));
    await waitFor(() => expect(mutateMeta).toHaveBeenCalled());
  });

  it("shows a connected Page with its Instagram handle and a Disconnect button (AC4)", async () => {
    mockMeta = CONNECTED;
    getMetaPages.mockResolvedValue(AVAILABLE_ONE_CONNECTED);
    render(<SettingsPage />);

    expect(card().getByText("Connected")).toBeTruthy();
    expect(card().getByText("Acme Catering")).toBeTruthy();
    expect(card().getByText(/@acme_ig/)).toBeTruthy();
    expect(card().getByRole("button", { name: "Disconnect" })).toBeTruthy();
    // The already-connected Page is not offered again in the picker.
    await waitFor(() => expect(getMetaPages).toHaveBeenCalled());
    expect(card().queryByRole("checkbox", { name: /Acme Catering/ })).toBeNull();
  });

  it("disconnects a Page and revalidates (AC5)", async () => {
    mockMeta = CONNECTED;
    getMetaPages.mockResolvedValue(AVAILABLE_ONE_CONNECTED);
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnectMetaPage).toHaveBeenCalledWith("PAGE1"));
    await waitFor(() => expect(mutateMeta).toHaveBeenCalled());
  });

  it("confirms success after the round trip through Meta", () => {
    mockSearchParams = new URLSearchParams("tab=integrations&meta=connected");
    render(<SettingsPage />);
    expect(card().getByText(/Facebook is connected/)).toBeTruthy();
  });

  it("explains a cancelled consent in plain English rather than a raw code", () => {
    mockSearchParams = new URLSearchParams("tab=integrations&meta_error=access_denied");
    render(<SettingsPage />);
    expect(card().getByText(/You cancelled before granting access/)).toBeTruthy();
    expect(card().queryByText("access_denied")).toBeNull();
  });

  it("surfaces per-Page failures instead of pretending they connected", async () => {
    mockMeta = AUTHORIZED_NO_PAGES;
    connectMetaPages.mockResolvedValue({ pages: [], errors: [{ page_id: "PAGE2", detail: "Could not subscribe this Page." }] });
    render(<SettingsPage />);

    const checkbox = await card().findByRole("checkbox", { name: /Acme Events/ });
    fireEvent.click(checkbox);
    fireEvent.click(card().getByRole("button", { name: "Connect selected Pages" }));

    await waitFor(() => expect(card().getByText(/Some Pages couldn't be connected: PAGE2/)).toBeTruthy());
  });
});
