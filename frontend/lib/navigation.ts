export interface NavPage {
  label: string;
  href: string;
}

export interface Department {
  name: string;
  icon: string;
  pages: NavPage[];
}

export const departments: Department[] = [
  {
    name: "Sales",
    icon: "briefcase",
    pages: [
      { label: "Leads", href: "/leads" },
      { label: "Quotes", href: "/quotes" },
      { label: "Events", href: "/events" },
      { label: "Invoices", href: "/invoices" },
      { label: "Menu Pricing", href: "/pricing" },
      { label: "Accounts", href: "/accounts" },
      { label: "Venues", href: "/venues" },
    ],
  },
  {
    name: "Kitchen",
    icon: "chef-hat",
    pages: [
      { label: "Portioning Calculator", href: "/calculate" },
      { label: "Menu Templates", href: "/menus" },
      { label: "Help", href: "/help" },
    ],
  },
  {
    name: "Warehouse",
    icon: "warehouse",
    pages: [
      { label: "Equipment", href: "/equipment" },
      { label: "Staff", href: "/staff" },
    ],
  },
  {
    name: "Admin",
    icon: "settings",
    pages: [
      { label: "Settings", href: "/settings" },
    ],
  },
];

/** Given a pathname, return which department it belongs to */
export function getActiveDepartment(pathname: string): Department | null {
  for (const dept of departments) {
    if (dept.pages.some((p) => pathname === p.href || pathname.startsWith(p.href + "/"))) {
      return dept;
    }
  }
  return null;
}
