// Client-side route guarding for role-restricted pages.
//
// NOTE: this is a UX guard only — the backend is the real security boundary and
// independently enforces these roles. It stops a user who types a URL directly
// from landing on a page they have no access to.
//
// Only list pages that are GENUINELY restricted. The dashboard ("/") is NOT here:
// it renders a salesperson-specific view, so everyone may visit it.

export interface ProtectedRoute {
  prefix: string;
  roles: string[];
}

export const PROTECTED_ROUTES: ProtectedRoute[] = [
  { prefix: "/settings", roles: ["owner", "admin"] },
  { prefix: "/team", roles: ["owner", "admin"] },
];

/** Roles required to view a path, or null if the path is unrestricted. */
export function requiredRolesFor(pathname: string): string[] | null {
  const match = PROTECTED_ROUTES.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
  return match ? match.roles : null;
}

/** Whether a user with `role` may view `pathname`. */
export function canAccess(pathname: string, role?: string): boolean {
  const roles = requiredRolesFor(pathname);
  if (!roles) return true;
  return !!role && roles.includes(role);
}
