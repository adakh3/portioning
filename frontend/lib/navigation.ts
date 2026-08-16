export interface NavPage {
  label: string;
  href: string;
  /** If set, only users with one of these roles can see the link */
  roles?: string[];
  /** If set, the link only shows when the named platform feature flag is on.
   *  "operations" gates the portioning/kitchen/staffing suite (hidden until
   *  launch). */
  flag?: "operations";
}

/** Platform feature flags (from useSiteSettings) that gate nav links. */
export interface NavFlags {
  operations?: boolean;
}

// The product is presented as a sharply revenue/CRM-focused app: a single top
// nav bar of sales pages, with admin-only tooling tucked into the user menu.
// The kitchen/portioning/staffing "operations" surfaces are hidden behind the
// OPERATIONS_ENABLED launch flag (flag: "operations") and reappear here when it
// flips on. Equipment + Menu Templates are NOT gated — admins manage them now.

/** Main horizontal nav (top bar), left→right. */
export const primaryNav: NavPage[] = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Follow-ups", href: "/follow-ups" },
  { label: "Quotes", href: "/quotes" },
  { label: "Events", href: "/events" },
  { label: "Calendar", href: "/calendar" },
  { label: "Menu Pricing", href: "/pricing" },
  { label: "Customers", href: "/customers" },
  { label: "Businesses", href: "/accounts" },
  { label: "Venues", href: "/venues" },
  // Hidden until the operations suite launches:
  { label: "Kitchen Events", href: "/kitchen/events", flag: "operations" },
  { label: "Portioning", href: "/calculate", flag: "operations" },
  { label: "Help", href: "/help", flag: "operations" },
];

/** Admin/owner tooling — surfaced in the top-right user menu, not the main bar. */
export const adminNav: NavPage[] = [
  { label: "Menu Templates", href: "/menus", roles: ["owner", "admin"] },
  { label: "Equipment", href: "/equipment", roles: ["owner", "admin"] },
  { label: "Staff", href: "/staff", roles: ["owner", "admin"], flag: "operations" },
  { label: "Settings", href: "/settings", roles: ["owner", "admin"] },
  { label: "Team", href: "/team", roles: ["owner", "admin"] },
];

/** Filter pages by user role and platform feature flags */
export function getVisiblePages(
  pages: NavPage[],
  userRole?: string,
  flags?: NavFlags,
): NavPage[] {
  return pages.filter((p) => {
    if (p.roles && !(userRole && p.roles.includes(userRole))) return false;
    if (p.flag && !flags?.[p.flag]) return false;
    return true;
  });
}

/** Whether `pathname` is (or is under) `href`. Root "/" matches exactly only. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
