"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveDepartment } from "@/lib/navigation";

export default function TopNav() {
  const pathname = usePathname();
  const dept = getActiveDepartment(pathname);

  if (!dept) return null;

  return (
    <nav className="bg-white border-b border-gray-200 px-6">
      <div className="flex items-center gap-1 h-11">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mr-3">
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
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                isActive
                  ? "bg-gray-100 text-gray-900 font-medium"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              {page.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
