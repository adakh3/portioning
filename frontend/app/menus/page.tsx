"use client";

import { useEffect, useState } from "react";
import { api, MenuTemplate } from "@/lib/api";
import MenuTemplateList from "@/components/MenuTemplateList";
import Link from "next/link";

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
          <h1 className="text-2xl font-bold text-gray-900">Menu Templates</h1>
          <p className="text-gray-500 mt-1">
            Select a menu template or create a custom menu
          </p>
        </div>
        <Link
          href="/calculate"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          Create Custom Menu
        </Link>
      </div>

      {loading && <p className="text-gray-500">Loading templates...</p>}
      {error && <p className="text-red-600">Error: {error}</p>}
      {!loading && !error && <MenuTemplateList templates={templates} />}
    </div>
  );
}
