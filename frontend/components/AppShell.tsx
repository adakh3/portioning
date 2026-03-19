"use client";

import { Suspense } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopNav from "@/components/TopNav";
import { AuthProvider, useAuth } from "@/lib/auth";

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const isLoginPage = pathname === "/login";

  // Show nothing while checking auth (prevents flash)
  if (loading) return null;

  // Login page — no shell
  if (isLoginPage) return <>{children}</>;

  // Not authenticated and not on login — AuthProvider will redirect
  if (!user) return null;

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
