import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/settings";
let role: string | undefined = "salesperson";
let loggedIn = true;
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: loggedIn ? { role } : null, loading: false }),
}));

// Sidebar/TopNav pull in many hooks; stub them — they're not under test here.
vi.mock("@/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("@/components/TopNav", () => ({ default: () => <div data-testid="topnav" /> }));

import AppShell from "./AppShell";

beforeEach(() => {
  replace.mockClear();
  pathname = "/settings";
  role = "salesperson";
  loggedIn = true;
});

describe("AppShell route guard", () => {
  it("redirects a salesperson away from /settings and hides its content", () => {
    render(<AppShell><div>SECRET SETTINGS</div></AppShell>);
    expect(replace).toHaveBeenCalledWith("/");
    expect(screen.queryByText("SECRET SETTINGS")).not.toBeInTheDocument();
  });

  it("lets an owner view /settings", () => {
    role = "owner";
    render(<AppShell><div>SECRET SETTINGS</div></AppShell>);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("SECRET SETTINGS")).toBeInTheDocument();
  });

  it("lets a salesperson view an unrestricted page", () => {
    pathname = "/leads";
    render(<AppShell><div>MY LEADS</div></AppShell>);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("MY LEADS")).toBeInTheDocument();
  });
});

// REL-482: "/" serves two audiences from one route, and the branch order in
// AppShell is what keeps them apart. Ordered wrongly, the public landing renders
// as a blank page for every visitor and only Playwright would notice.
describe("AppShell public landing at /", () => {
  it("renders the landing bare for a logged-out visitor, with no app chrome", () => {
    loggedIn = false;
    pathname = "/";
    render(<AppShell><div>LANDING</div></AppShell>);
    expect(screen.getByText("LANDING")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("topnav")).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("still renders the full shell at / for a signed-in user", () => {
    pathname = "/";
    render(<AppShell><div>DASHBOARD</div></AppShell>);
    expect(screen.getByText("DASHBOARD")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("shows a logged-out visitor nothing on a protected route", () => {
    loggedIn = false;
    pathname = "/quotes";
    render(<AppShell><div>SECRET QUOTES</div></AppShell>);
    expect(screen.queryByText("SECRET QUOTES")).not.toBeInTheDocument();
  });
});
