"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import { AuthProvider, useAuth } from "@/lib/auth";
import { OrgLocaleProvider } from "@/lib/orgLocale";
import { canAccess } from "@/lib/routeAccess";
import { useSiteSettings } from "@/lib/hooks";

// The operations suite (portioning, kitchen, staffing, help) is hidden behind
// the OPERATIONS_ENABLED launch flag. These paths are only reachable when the
// flag is on; otherwise a typed URL redirects home.
const OPERATIONS_ROUTES = ["/calculate", "/help", "/kitchen", "/staff"];

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const { data: settings } = useSiteSettings();
  const isLoginPage = pathname === "/login";

  // Redirect users who reach a role-restricted page by typing its URL.
  const allowed = canAccess(pathname, user?.role);
  // Gate operations routes on the launch flag. `undefined` while settings load
  // — we hold rendering (below) rather than flash the page before deciding.
  const onOperationsRoute = OPERATIONS_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const operationsBlocked = onOperationsRoute && settings ? !settings.operations_enabled : false;
  useEffect(() => {
    if (!loading && user && !allowed) router.replace("/");
    else if (!loading && user && operationsBlocked) router.replace("/");
  }, [loading, user, allowed, operationsBlocked, router]);

  // Public client-facing pages (e.g. /b/<token> sign links) render bare — no
  // app chrome, and without waiting on the staff auth bootstrap.
  if (pathname.startsWith("/b/")) return <>{children}</>;

  // Show nothing while checking auth (prevents flash)
  if (loading) return null;

  // Logged-out visitors at the root get the public marketing landing, bare.
  if (!user && pathname === "/") return <>{children}</>;

  // Login page — no shell
  if (isLoginPage) return <>{children}</>;

  // Not authenticated and not on login — AuthProvider will redirect
  if (!user) return null;

  // Don't flash restricted content before the redirect lands
  if (!allowed) return null;

  // On an operations route, wait for the flag to resolve, then block if off.
  if (onOperationsRoute && (!settings || operationsBlocked)) return null;

  const widePages = ["/leads", "/dashboard"];
  const isWidePage = widePages.some((p) => pathname === p || pathname.startsWith(p + "/"));

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className={`flex-1 w-full mx-auto px-6 py-8 ${isWidePage ? "" : "max-w-7xl"}`}>
        {children}
      </main>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthProvider>
        <OrgLocaleProvider>
          <AppShellInner>{children}</AppShellInner>
        </OrgLocaleProvider>
      </AuthProvider>
    </Suspense>
  );
}
