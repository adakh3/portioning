import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import type { MailboxStatus } from "@/lib/api";

// REL-460 — the "Client email" card on Settings → Integrations. Driven through
// the real page, so the failures this pins are wiring ones: the card not
// reaching the right endpoint, not navigating to the consent URL, or showing the
// connected state when the connection is actually broken.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));
vi.mock("@/lib/useQueryState", () => ({
  useQueryState: () => ["integrations", vi.fn()],
}));

let mockMailbox: MailboxStatus;
// One stable object — a fresh `{}` per call re-fires the settings effect forever.
const SETTINGS = { currency_symbol: "$", currency_code: "USD", date_format: "MM/DD/YYYY" };
const mutateMailbox = vi.fn();
vi.mock("@/lib/hooks", () => ({
  useSiteSettings: () => ({ data: SETTINGS, isLoading: false, mutate: vi.fn() }),
  useConnectedMailbox: () => ({
    data: mockMailbox,
    isLoading: false,
    mutate: mutateMailbox,
  }),
}));

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

const startMailboxConnect = vi.fn();
const disconnectMailbox = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/api", () => ({
  api: {
    updateSiteSettings: vi.fn(),
    startMailboxConnect: (p: unknown) => startMailboxConnect(p),
    disconnectMailbox: () => disconnectMailbox(),
  },
}));

// Sibling panels on other tabs pull in their own data hooks.
vi.mock("@/components/LeadStatusesSettings", () => ({ default: () => null }));
vi.mock("@/components/ChoiceOptionsSettings", () => ({ default: () => null }));
vi.mock("@/components/ProductLinesSettings", () => ({ default: () => null }));
vi.mock("@/components/CommissionSettings", () => ({ default: () => null }));
vi.mock("@/components/BillingPanel", () => ({ default: () => null }));

import SettingsPage from "./page";

const DISCONNECTED: MailboxStatus = {
  connected: false,
  mailbox: null,
  providers_available: ["google", "microsoft"],
};

const CONNECTED: MailboxStatus = {
  connected: true,
  providers_available: ["google", "microsoft"],
  mailbox: {
    id: 1,
    provider: "google",
    provider_display: "Google",
    email_address: "owner@acme.com",
    status: "connected",
    last_error: "",
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  },
};

// The WhatsApp card sits on the same tab and says "Not connected" too, so every
// assertion is scoped to this card rather than the whole page.
function card() {
  return within(screen.getByText("Client email").closest("div.rounded-lg") as HTMLElement);
}

function stubNavigation() {
  const location = { href: "" };
  Object.defineProperty(window, "location", {
    value: location,
    writable: true,
    configurable: true,
  });
  return location;
}

beforeEach(() => {
  startMailboxConnect.mockReset().mockResolvedValue({ auth_url: "https://accounts.google.com/consent" });
  disconnectMailbox.mockClear();
  mutateMailbox.mockClear();
  mockSearchParams = new URLSearchParams();
  mockMailbox = DISCONNECTED;
});

describe("Settings → Integrations → Client email", () => {
  it("offers both providers when nothing is connected", () => {
    render(<SettingsPage />);

    expect(card().getByText("Client email")).toBeTruthy();
    expect(card().getByText("Not connected")).toBeTruthy();
    expect(card().getByRole("button", { name: "Connect Google" })).toBeTruthy();
    expect(card().getByRole("button", { name: "Connect Microsoft" })).toBeTruthy();
  });

  it("sends the browser to the Google consent URL the backend returns (AC1)", async () => {
    const location = stubNavigation();
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Connect Google" }));

    await waitFor(() => expect(startMailboxConnect).toHaveBeenCalledWith("google"));
    await waitFor(() =>
      expect(location.href).toBe("https://accounts.google.com/consent"),
    );
  });

  it("sends the browser to the Microsoft consent URL (AC2)", async () => {
    startMailboxConnect.mockResolvedValue({ auth_url: "https://login.microsoftonline.com/consent" });
    const location = stubNavigation();
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Connect Microsoft" }));

    await waitFor(() => expect(startMailboxConnect).toHaveBeenCalledWith("microsoft"));
    await waitFor(() =>
      expect(location.href).toBe("https://login.microsoftonline.com/consent"),
    );
  });

  it("shows the connected address and provider, and no connect buttons (AC1)", () => {
    mockMailbox = CONNECTED;
    render(<SettingsPage />);

    expect(card().getByText("Connected")).toBeTruthy();
    expect(card().getByText("owner@acme.com")).toBeTruthy();
    expect(card().getByText(/Google/)).toBeTruthy();
    expect(card().queryByRole("button", { name: "Connect Google" })).toBeNull();
    expect(card().getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });

  it("disconnects and revalidates the card (AC6)", async () => {
    mockMailbox = CONNECTED;
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnectMailbox).toHaveBeenCalled());
    await waitFor(() => expect(mutateMailbox).toHaveBeenCalled());
    expect(card().getByText(/disconnected/i)).toBeTruthy();
  });

  it("surfaces a failed disconnect instead of pretending it worked", async () => {
    mockMailbox = CONNECTED;
    disconnectMailbox.mockRejectedValueOnce(new Error("Server exploded"));
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(card().getByText("Server exploded")).toBeTruthy());
  });

  it("prompts to reconnect when the connection is broken (AC5)", () => {
    mockMailbox = {
      ...CONNECTED,
      mailbox: { ...CONNECTED.mailbox!, status: "needs_reconnect", last_error: "invalid_grant" },
    };
    render(<SettingsPage />);

    expect(card().getByText("Needs reconnect")).toBeTruthy();
    expect(card().getByText(/no longer send from this account/i)).toBeTruthy();
    expect(card().getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });

  it("reconnects through the same provider that broke (AC5)", async () => {
    mockMailbox = {
      ...CONNECTED,
      mailbox: { ...CONNECTED.mailbox!, provider: "microsoft", provider_display: "Microsoft", status: "needs_reconnect" },
    };
    stubNavigation();
    render(<SettingsPage />);

    fireEvent.click(card().getByRole("button", { name: "Reconnect" }));

    await waitFor(() => expect(startMailboxConnect).toHaveBeenCalledWith("microsoft"));
  });

  it("confirms success after the round trip through the provider", () => {
    mockSearchParams = new URLSearchParams("tab=integrations&email=connected");
    mockMailbox = CONNECTED;
    render(<SettingsPage />);

    expect(card().getByText("Your email is connected.")).toBeTruthy();
  });

  it("explains a cancelled consent in plain English rather than a raw code", () => {
    mockSearchParams = new URLSearchParams("tab=integrations&email_error=access_denied");
    render(<SettingsPage />);

    expect(card().getByText(/You cancelled before granting access/)).toBeTruthy();
    expect(card().queryByText("access_denied")).toBeNull();
  });

  it("has a fallback message for an error code it does not recognise", () => {
    mockSearchParams = new URLSearchParams("tab=integrations&email_error=something_new");
    render(<SettingsPage />);

    expect(card().getByText(/couldn't connect that account/i)).toBeTruthy();
  });

  it("only offers the providers the deployment actually has configured", () => {
    mockMailbox = { ...DISCONNECTED, providers_available: ["google"] };
    render(<SettingsPage />);

    expect(card().getByRole("button", { name: "Connect Google" })).toBeTruthy();
    expect(card().queryByRole("button", { name: "Connect Microsoft" })).toBeNull();
  });

  it("says so plainly when the deployment can't send email at all", () => {
    mockMailbox = { ...DISCONNECTED, providers_available: [] };
    render(<SettingsPage />);

    expect(card().getByText(/isn't switched on for this installation/i)).toBeTruthy();
    expect(card().queryByRole("button", { name: /^Connect/ })).toBeNull();
  });

  it("still offers Reconnect when the deployment has dropped that provider", () => {
    // Otherwise the card is a dead end: "needs reconnect" with no way to do it.
    mockMailbox = {
      connected: true,
      providers_available: ["google"],
      mailbox: {
        ...CONNECTED.mailbox!,
        provider: "microsoft",
        provider_display: "Microsoft",
        status: "needs_reconnect",
      },
    };
    render(<SettingsPage />);

    expect(card().getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });
});
