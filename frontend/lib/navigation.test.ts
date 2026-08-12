import { describe, it, expect } from "vitest";
import {
  getVisiblePages,
  isActivePath,
  primaryNav,
  adminNav,
  type NavPage,
} from "./navigation";

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

  it("hides flag-gated pages when the flag is off (default)", () => {
    const flagged: NavPage[] = [
      { label: "Always", href: "/a" },
      { label: "Ops", href: "/ops", flag: "operations" },
    ];
    expect(getVisiblePages(flagged, "owner").map((p) => p.label)).toEqual(["Always"]);
    expect(getVisiblePages(flagged, "owner", {}).map((p) => p.label)).toEqual(["Always"]);
  });

  it("shows flag-gated pages when the flag is on", () => {
    const flagged: NavPage[] = [
      { label: "Always", href: "/a" },
      { label: "Ops", href: "/ops", flag: "operations" },
    ];
    expect(
      getVisiblePages(flagged, "owner", { operations: true }).map((p) => p.label),
    ).toEqual(["Always", "Ops"]);
  });
});

describe("operations suite is hidden until the launch flag flips", () => {
  const opsHrefs = ["/calculate", "/kitchen/events", "/help", "/staff"];

  it("hides every operations page from the primary + admin nav by default", () => {
    const visible = [
      ...getVisiblePages(primaryNav, "owner"),
      ...getVisiblePages(adminNav, "owner"),
    ].map((p) => p.href);
    for (const href of opsHrefs) expect(visible).not.toContain(href);
  });

  it("reveals the operations pages when the flag is on", () => {
    const visible = [
      ...getVisiblePages(primaryNav, "owner", { operations: true }),
      ...getVisiblePages(adminNav, "owner", { operations: true }),
    ].map((p) => p.href);
    for (const href of opsHrefs) expect(visible).toContain(href);
  });
});

describe("primary nav is the revenue story", () => {
  it("shows the core revenue pages to a salesperson", () => {
    const labels = getVisiblePages(primaryNav, "salesperson").map((p) => p.label);
    for (const l of ["Dashboard", "Leads", "Follow-ups", "Quotes", "Events", "Menu Pricing"]) {
      expect(labels).toContain(l);
    }
  });

  it("never leaks admin tooling into the primary bar", () => {
    const hrefs = primaryNav.map((p) => p.href);
    for (const href of ["/settings", "/team", "/menus", "/equipment"]) {
      expect(hrefs).not.toContain(href);
    }
  });
});

describe("admin menu gating", () => {
  const labels = (role?: string, flags?: { operations?: boolean }) =>
    getVisiblePages(adminNav, role, flags).map((p) => p.label);

  it("hides admin tooling from manager / salesperson / chef", () => {
    for (const role of ["manager", "salesperson", "chef"]) {
      expect(labels(role)).not.toContain("Settings");
      expect(labels(role)).not.toContain("Team");
      expect(labels(role)).not.toContain("Equipment");
      expect(labels(role)).not.toContain("Menu Templates");
    }
  });

  it("gives admins Settings, Team, Equipment and Menu Templates now", () => {
    for (const role of ["admin", "owner"]) {
      expect(labels(role)).toEqual(
        expect.arrayContaining(["Menu Templates", "Equipment", "Settings", "Team"]),
      );
    }
  });

  it("keeps Staff hidden for admins until the operations flag is on", () => {
    expect(labels("owner")).not.toContain("Staff");
    expect(labels("owner", { operations: true })).toContain("Staff");
  });
});

describe("isActivePath", () => {
  it("matches root only exactly", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/leads", "/")).toBe(false);
  });

  it("matches a page and its nested paths", () => {
    expect(isActivePath("/leads", "/leads")).toBe(true);
    expect(isActivePath("/leads/123", "/leads")).toBe(true);
    expect(isActivePath("/leadsX", "/leads")).toBe(false);
  });
});
