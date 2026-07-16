import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "new" }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: "owner" } }) }));

const empty = { data: [], mutate: vi.fn() };
vi.mock("@/lib/hooks", () => ({
  useLead: () => ({ data: undefined, error: null, isLoading: false, mutate: vi.fn() }),
  useSiteSettings: () => ({ data: undefined }),
  useDateFormat: () => "DD/MM/YYYY",
  useProductLines: () => empty,
  useUsers: () => empty,
  useSources: () => empty,
  useEventTypes: () => empty,
  useServiceStyles: () => empty,
  useMealTypes: () => empty,
  useLeadStatuses: () => empty,
  useLostReasons: () => empty,
  useLeadReminders: () => empty,
  useLeadWhatsAppMessages: () => empty,
  useLeadFollowUpDrafts: () => empty,
  useAccounts: () => empty,
  revalidate: vi.fn(),
}));

const createLead = vi.fn().mockResolvedValue({ id: 123 });
vi.mock("@/lib/api", () => ({
  api: {
    createLead: (d: unknown) => createLead(d),
    getAccounts: vi.fn().mockResolvedValue([]),
  },
}));

import LeadPage from "./page";

describe("Lead create form", () => {
  beforeEach(() => createLead.mockClear());

  it("sends the contact title in the create payload", async () => {
    render(<LeadPage />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ms" } });
    const nameInput = screen.getAllByRole("textbox")[0]; // Contact Name is the first text input
    fireEvent.change(nameInput, { target: { value: "Batool Rizvi" } });
    const form = nameInput.closest("form")!;
    const phoneInput = form.querySelector("input[type=tel]")!;
    fireEvent.change(phoneInput, { target: { value: "03001269792" } });
    fireEvent.submit(form);

    await waitFor(() => expect(createLead).toHaveBeenCalledTimes(1));
    const payload = createLead.mock.calls[0][0];
    expect(payload.contact_title).toBe("Ms");
    expect(payload.contact_name).toBe("Batool Rizvi");
  });
});
