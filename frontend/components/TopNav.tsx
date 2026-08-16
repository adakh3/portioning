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
              {/* Settings, Team and the rest of the admin tooling live ONLY behind
                  this control, so it has to read as a menu. As a bare name with a
                  12px chevron it did not: the owner could not find their own
                  Settings after the nav moved here, and a caterer would fare no
                  better. It is now a bordered control with a gear — the thing
                  people look for when they want settings — and it announces
                  itself to assistive tech as a menu button. */}
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account and admin menu"
                className={cn(
                  "flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors",
                  menuOpen
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="hidden sm:inline">{user.first_name} {user.last_name}</span>
                <span className="px-1.5 py-0.5 rounded bg-accent text-[10px] font-medium uppercase">
                  {user.role}
                </span>
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-48 rounded-md border border-border bg-popover shadow-lg py-1 z-50">
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
