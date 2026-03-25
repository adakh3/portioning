import { describe, it, expect } from "vitest";
import { getVisiblePages, getActiveDepartment, departments, type NavPage } from "./navigation";

describe("getVisiblePages", () => {
  const pages: NavPage[] = [
    { label: "Public", href: "/public" },
    { label: "Manager Only", href: "/manager", roles: ["manager", "owner"] },
    { label: "All Roles", href: "/all" },
  ];

  it("returns all pages when no role restriction and no user role", () => {
    const unrestricted: NavPage[] = [
      { label: "A", href: "/a" },
      { label: "B", href: "/b" },
    ];
    expect(getVisiblePages(unrestricted)).toEqual(unrestricted);
  });

  it("hides role-restricted pages when user has no role", () => {
    const result = getVisiblePages(pages);
    expect(result.map((p) => p.label)).toEqual(["Public", "All Roles"]);
  });

  it("shows role-restricted pages when user has matching role", () => {
    const result = getVisiblePages(pages, "manager");
    expect(result.map((p) => p.label)).toEqual(["Public", "Manager Only", "All Roles"]);
  });

  it("hides role-restricted pages when user has non-matching role", () => {
    const result = getVisiblePages(pages, "salesperson");
    expect(result.map((p) => p.label)).toEqual(["Public", "All Roles"]);
  });
});

describe("getActiveDepartment", () => {
  it("returns Sales for /leads", () => {
    expect(getActiveDepartment("/leads")?.name).toBe("Sales");
  });

  it("returns Sales for nested lead path /leads/123", () => {
    expect(getActiveDepartment("/leads/123")?.name).toBe("Sales");
  });

  it("returns Kitchen for /calculate", () => {
    expect(getActiveDepartment("/calculate")?.name).toBe("Kitchen");
  });

  it("returns Kitchen for /kitchen/events", () => {
    expect(getActiveDepartment("/kitchen/events")?.name).toBe("Kitchen");
  });

  it("returns Warehouse for /equipment", () => {
    expect(getActiveDepartment("/equipment")?.name).toBe("Warehouse");
  });

  it("returns Admin for /settings", () => {
    expect(getActiveDepartment("/settings")?.name).toBe("Admin");
  });

  it("returns null for unknown path", () => {
    expect(getActiveDepartment("/unknown")).toBeNull();
  });

  it("returns Sales for root path /", () => {
    expect(getActiveDepartment("/")?.name).toBe("Sales");
  });
});
