import { describe, it, expect } from "vitest";
import { canAccess, requiredRolesFor } from "./routeAccess";

describe("routeAccess", () => {
  it("treats unlisted routes (incl. the dashboard) as open to everyone", () => {
    expect(requiredRolesFor("/")).toBeNull();
    expect(requiredRolesFor("/leads")).toBeNull();
    expect(canAccess("/", "salesperson")).toBe(true);
    expect(canAccess("/leads", undefined)).toBe(true);
  });

  it("restricts /settings and /team to owner/admin", () => {
    expect(requiredRolesFor("/settings")).toEqual(["owner", "admin"]);
    expect(canAccess("/settings", "salesperson")).toBe(false);
    expect(canAccess("/settings", "manager")).toBe(false);
    expect(canAccess("/settings", "admin")).toBe(true);
    expect(canAccess("/team", "owner")).toBe(true);
  });

  it("matches nested paths under a protected prefix", () => {
    expect(canAccess("/settings/billing", "salesperson")).toBe(false);
    expect(canAccess("/settings/billing", "owner")).toBe(true);
  });

  it("denies when the role is missing", () => {
    expect(canAccess("/settings", undefined)).toBe(false);
  });
});
