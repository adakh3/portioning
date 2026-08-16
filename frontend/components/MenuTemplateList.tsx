"use client";

import { MenuTemplate } from "@/lib/api";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  templates: MenuTemplate[];
  /** When true, each card links into the portioning calculator. Off while the
   *  operations suite is hidden — cards then render as plain, non-linked tiles. */
  linkToCalculator?: boolean;
  /** When set (owner/admin), each card links to the template editor at
   *  `${editHrefBase}/<id>` instead of the calculator. */
  editHrefBase?: string;
}

export default function MenuTemplateList({ templates, linkToCalculator, editHrefBase }: Props) {
  const clickable = !!editHrefBase || linkToCalculator;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {templates.map((t) => {
        const card = (
          <Card className={clickable ? "hover:shadow-lg hover:border-primary/30 transition-all" : ""}>
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
        );
        // Editing (admin) takes precedence over the calculator link.
        const href = editHrefBase ? `${editHrefBase}/${t.id}` : linkToCalculator ? `/calculate?template=${t.id}` : null;
        return href ? (
          <Link key={t.id} href={href} className="block">
            {card}
          </Link>
        ) : (
          <div key={t.id}>{card}</div>
        );
      })}
    </div>
  );
}
