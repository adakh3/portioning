"use client";

import { useMenus, useSiteSettings } from "@/lib/hooks";
import { useAuth } from "@/lib/auth";
import MenuTemplateList from "@/components/MenuTemplateList";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MenusPage() {
  const { data: templates = [], error, isLoading: loading } = useMenus();
  const { data: settings } = useSiteSettings();
  const { user } = useAuth();
  const operationsOn = !!settings?.operations_enabled;
  const canManage = user?.role === "owner" || user?.role === "admin" || !!user?.is_superuser;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Menu Templates</h1>
          <p className="text-muted-foreground mt-1">
            {canManage
              ? "Build and edit your menu templates — pick dishes, group them into courses."
              : operationsOn
                ? "Select a menu template or create a custom menu"
                : "Your menu templates"}
          </p>
        </div>
        {canManage ? (
          <Button asChild>
            <Link href="/menus/new">+ New menu</Link>
          </Button>
        ) : operationsOn ? (
          <Button asChild>
            <Link href="/calculate">Create Custom Menu</Link>
          </Button>
        ) : null}
      </div>

      {loading && <p className="text-muted-foreground">Loading templates...</p>}
      {error && <p className="text-destructive">Error: {error?.message}</p>}
      {!loading && !error && (
        templates.length === 0 ? (
          <p className="text-muted-foreground">
            No menu templates yet.{canManage && " Use “+ New menu” to build your first."}
          </p>
        ) : (
          <MenuTemplateList
            templates={templates}
            linkToCalculator={operationsOn && !canManage}
            editHrefBase={canManage ? "/menus" : undefined}
          />
        )
      )}
    </div>
  );
}
