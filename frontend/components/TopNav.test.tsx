/** The top nav's account/admin menu.
 *
 * This control is the ONLY way to reach Settings, Team, Menu Templates and
 * Equipment since the left sidebar was removed. It shipped as a bare name with
 * a 12px chevron and the owner could not find his own Settings in production —
 * so what is pinned here is not the styling but the two properties that make it
 * findable at all: it looks and announces itself like a menu, and the admin
 * links are actually inside it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let pathname = "/";
let mockUser: { first_name: string; last_name: string; role: string } | null = null;

vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: mockUser, logout: vi.fn() }),
}));
vi.mock("@/lib/hooks", () => ({
  useFollowUpDraftCount: () => ({ data: 0 }),
  useSiteSettings: () => ({ data: { operations_enabled: false } }),
}));
vi.mock("@/components/OrgSwitcher", () => ({ default: () => null }));

import TopNav from "./TopNav";

const OWNER = { first_name: "Olivia", last_name: "Owner", role: "owner" };

beforeEach(() => {
  pathname = "/";
  mockUser = { ...OWNER };
});

describe("TopNav account menu", () => {
  it("announces itself as a menu button rather than a plain name", () => {
    render(<TopNav />);
    const trigger = screen.getByRole("button", { name: /account and admin menu/i });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on click and reports itself expanded", () => {
    render(<TopNav />);
    const trigger = screen.getByRole("button", { name: /account and admin menu/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("an owner finds Settings and Team inside it", () => {
    render(<TopNav />);
    fireEvent.click(screen.getByRole("button", { name: /account and admin menu/i }));
    const menu = screen.getByRole("menu");
    for (const label of ["Settings", "Team", "Menu Templates", "Equipment"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    expect(menu.textContent).toContain("Sign out");
  });

  it("Settings points at /settings", () => {
    render(<TopNav />);
    fireEvent.click(screen.getByRole("button", { name: /account and admin menu/i }));
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href"))
      .toBe("/settings");
  });

  it("a salesperson gets no admin links, only sign out", () => {
    mockUser = { first_name: "Sam", last_name: "Sales", role: "salesperson" };
    render(<TopNav />);
    fireEvent.click(screen.getByRole("button", { name: /account and admin menu/i }));
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("menu").textContent).toContain("Sign out");
  });

  it("renders nothing for a logged-out visitor", () => {
    mockUser = null;
    render(<TopNav />);
    expect(screen.queryByRole("button", { name: /account and admin menu/i })).toBeNull();
  });
});
