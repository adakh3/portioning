"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { mutate } from "swr";
import { api, AuthUser } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: number | "all" | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Only ever return to a path on this site.
 *
 * `returnTo` is read straight off the query string, so without this a crafted
 * `/login?returnTo=https://elsewhere.example` would send someone off-site the
 * moment they signed in — with their guard down, having just typed a password.
 * A leading `//` is the same trick in protocol-relative clothing.
 */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Bootstrap CSRF cookie before any authenticated requests
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"}/auth/login/`, {
      credentials: "include",
    })
      .catch(() => {})  // best-effort
      .finally(() => {
        api.getMe()
          .then(setUser)
          .catch(() => setUser(null))
          .finally(() => setLoading(false));
      });
  }, []);

  // Route protection
  useEffect(() => {
    if (loading) return;
    const isLoginPage = pathname === "/login";
    // Public, unauthenticated client-facing pages (e.g. the /b/<token> sign link)
    // must never bounce a logged-out customer to the staff login. The root is
    // public too: logged-out visitors get the marketing landing there (REL-482).
    const isPublicPage =
      isLoginPage || pathname.startsWith("/b/") || pathname === "/" || pathname === "/privacy";
    if (!user && !isPublicPage) {
      // Keep the query string. `usePathname()` drops it, which is how a bounce
      // from /settings?tab=integrations&email=connected came back as a bare
      // /settings — losing both the tab and the "mailbox connected" result the
      // user was being sent there to see (REL-477).
      const query = searchParams.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(`/login?returnTo=${encodeURIComponent(target)}`);
    } else if (user && isLoginPage) {
      router.replace(safeReturnTo(searchParams.get("returnTo")));
    }
  }, [user, loading, pathname, searchParams, router]);

  const login = useCallback(async (email: string, password: string, returnTo?: string) => {
    const u = await api.login(email, password);
    setUser(u);
    // Same untrusted source as the guard above — the login page reads it off
    // the query string and hands it here verbatim.
    router.push(safeReturnTo(returnTo ?? null));
  }, [router]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    router.push("/login");
  }, [router]);

  const switchOrg = useCallback(async (orgId: number | "all" | null) => {
    const u = await api.switchOrg(orgId);
    setUser(u);
    // Every cached query is org-scoped — drop all SWR caches and refetch so the
    // whole app reflects the newly-active org.
    await mutate(() => true, undefined, { revalidate: true });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, switchOrg }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
