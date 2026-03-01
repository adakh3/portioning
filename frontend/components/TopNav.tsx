"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveDepartment } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export default function TopNav() {
  const pathname = usePathname();
  const dept = getActiveDepartment(pathname);

  if (!dept) return null;

  return (
    <nav className="bg-background border-b border-border px-6">
      <div className="flex items-center gap-1 h-11">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-3">
          {dept.name}
        </span>
        {dept.pages.map((page) => {
          const isActive =
            pathname === page.href ||
            pathname.startsWith(page.href + "/");
          return (
            <Link
              key={page.href}
              href={page.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              )}
            >
              {page.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
