"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { AuthProvider, useAuth } from "@/lib/auth";
import { canAccess } from "@/lib/routeAccess";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();
  const isLoginPage = pathname === "/login";

  // Redirect users who reach a role-restricted page by typing its URL.
  const allowed = canAccess(pathname, user?.role);
  useEffect(() => {
    if (!loading && user && !allowed) router.replace("/");
  }, [loading, user, allowed, router]);

  // Show nothing while checking auth (prevents flash)
  if (loading) return null;

  // Login page — no shell
  if (isLoginPage) return <>{children}</>;

  // Not authenticated and not on login — AuthProvider will redirect
  if (!user) return null;

  // Don't flash restricted content before the redirect lands
  if (!allowed) return null;

  const widePages = ["/leads", "/dashboard"];
  const isWidePage = widePages.some((p) => pathname === p || pathname.startsWith(p + "/"));

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopNav />
        <main className={`flex-1 w-full mx-auto px-6 py-8 ${isWidePage ? "" : "max-w-7xl"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AuthProvider>
        <AppShellInner>{children}</AppShellInner>
      </AuthProvider>
    </Suspense>
  );
}
