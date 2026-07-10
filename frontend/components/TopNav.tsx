"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveDepartment, getVisiblePages } from "@/lib/navigation";
import { useAuth } from "@/lib/auth";
import { useFollowUpDraftCount } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import OrgSwitcher from "@/components/OrgSwitcher";

export default function TopNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const dept = getActiveDepartment(pathname);
  const { data: draftCount } = useFollowUpDraftCount();

  return (
    <nav className="bg-background border-b border-border px-6">
      <div className="flex items-center h-11">
        {dept && (
          <>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-3">
              {dept.name}
            </span>
            {getVisiblePages(dept.pages, user?.role).map((page) => {
              const isActive =
                pathname === page.href ||
                pathname.startsWith(page.href + "/");
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm transition-colors inline-flex items-center gap-1.5",
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
          </>
        )}

        {user && (
          <div className="ml-auto flex items-center gap-3">
            <OrgSwitcher />
            <span className="text-xs text-muted-foreground">
              {user.first_name} {user.last_name}
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-accent text-[10px] font-medium uppercase">
                {user.role}
              </span>
            </span>
            <button
              onClick={logout}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
