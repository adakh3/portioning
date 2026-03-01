"use client";

import { useEffect, useState } from "react";
import { api, MenuTemplate } from "@/lib/api";
import MenuTemplateList from "@/components/MenuTemplateList";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function MenusPage() {
  const [templates, setTemplates] = useState<MenuTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMenus()
      .then(setTemplates)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Menu Templates</h1>
          <p className="text-muted-foreground mt-1">
            Select a menu template or create a custom menu
          </p>
        </div>
        <Button asChild>
          <Link href="/calculate">
            Create Custom Menu
          </Link>
        </Button>
      </div>

      {loading && <p className="text-muted-foreground">Loading templates...</p>}
      {error && <p className="text-destructive">Error: {error}</p>}
      {!loading && !error && <MenuTemplateList templates={templates} />}
    </div>
  );
}
