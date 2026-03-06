"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { api, AuthUser } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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
    if (!user && !isLoginPage) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    } else if (user && isLoginPage) {
      const returnTo = searchParams.get("returnTo") || "/";
      router.replace(returnTo);
    }
  }, [user, loading, pathname, searchParams, router]);

  const login = useCallback(async (email: string, password: string, returnTo?: string) => {
    const u = await api.login(email, password);
    setUser(u);
    router.push(returnTo || "/");
  }, [router]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
