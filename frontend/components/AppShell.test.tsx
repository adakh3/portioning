import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let pathname = "/settings";
let role: string | undefined = "salesperson";
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

vi.mock("@/lib/auth", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: { role }, loading: false }),
}));

// Sidebar/TopNav pull in many hooks; stub them — they're not under test here.
vi.mock("@/components/Sidebar", () => ({ default: () => <div data-testid="sidebar" /> }));
vi.mock("@/components/TopNav", () => ({ default: () => <div data-testid="topnav" /> }));

import AppShell from "./AppShell";

beforeEach(() => {
  replace.mockClear();
  pathname = "/settings";
  role = "salesperson";
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
