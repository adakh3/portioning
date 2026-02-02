"use client";

import { MenuTemplate } from "@/lib/api";
import Link from "next/link";

interface Props {
  templates: MenuTemplate[];
}

export default function MenuTemplateList({ templates }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {templates.map((t) => (
        <Link
          key={t.id}
          href={`/calculate?template=${t.id}`}
          className="block border border-gray-200 rounded-lg p-6 hover:shadow-lg hover:border-blue-300 transition-all"
        >
          <h3 className="text-lg font-semibold text-gray-900">{t.name}</h3>
          <p className="text-sm text-gray-500 mt-1">{t.description}</p>
          <div className="mt-4 flex gap-4 text-sm text-gray-600">
            <span>{t.dish_count} dishes</span>
            <span>
              {t.default_gents}% Gents / {t.default_ladies}% Ladies
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
