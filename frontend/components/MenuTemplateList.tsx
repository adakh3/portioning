"use client";

import { MenuTemplate } from "@/lib/api";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

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
          className="block"
        >
          <Card className="hover:shadow-lg hover:border-primary/30 transition-all">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-foreground">{t.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
              <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                <span>{t.dish_count} dishes</span>
                <span>
                  {t.default_gents}% Gents / {t.default_ladies}% Ladies
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
