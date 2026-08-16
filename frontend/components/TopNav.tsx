"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNav, adminNav, getVisiblePages, isActivePath } from "@/lib/navigation";
import { useAuth } from "@/lib/auth";
import { useFollowUpDraftCount, useSiteSettings } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import OrgSwitcher from "@/components/OrgSwitcher";

export default function TopNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { data: draftCount } = useFollowUpDraftCount();
  const { data: settings } = useSiteSettings();
  const flags = { operations: settings?.operations_enabled };

  const pages = getVisiblePages(primaryNav, user?.role, flags);
  const adminPages = getVisiblePages(adminNav, user?.role, flags);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);
  // Close the menu on navigation.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <nav className="bg-background border-b border-border px-6">
      <div className="flex items-center h-12 gap-1">
        <Link href="/" className="text-base font-bold tracking-tight mr-4 shrink-0">
          Relogue
        </Link>

        <div className="flex items-center gap-0.5 overflow-x-auto">
          {pages.map((page) => {
            const isActive = isActivePath(pathname, page.href);
            return (
              <Link
                key={page.href}
                href={page.href}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm transition-colors inline-flex items-center gap-1.5 whitespace-nowrap",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {page.label}
                {page.href === "/follow-ups" && !!draftCount?.pending && (
                  <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none">
                    {draftCount.pending}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {user && (
          <div className="ml-auto flex items-center gap-3 shrink-0">
            <OrgSwitcher />
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {user.first_name} {user.last_name}
                <span className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-medium uppercase">
                  {user.role}
                </span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-popover shadow-lg py-1 z-50">
                  {adminPages.map((page) => (
                    <Link
                      key={page.href}
                      href={page.href}
                      className={cn(
                        "block px-3 py-2 text-sm transition-colors",
                        isActivePath(pathname, page.href)
                          ? "bg-accent text-accent-foreground font-medium"
                          : "text-foreground hover:bg-accent/50"
                      )}
                    >
                      {page.label}
                    </Link>
                  ))}
                  {adminPages.length > 0 && <div className="my-1 border-t border-border" />}
                  <button
                    onClick={logout}
                    className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent/50 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
