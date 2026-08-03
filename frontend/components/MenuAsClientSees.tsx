"use client";

import type { MenuLineGroup } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

/** The menu exactly as the client reads it on the proposal — course by course, with
 * offered dishes already collapsed into one "Choice of: A / B / C" line (REL-419
 * AC13).
 *
 * The lines are rendered SERVER-side by `booking_menu_courses`, the same function
 * behind the quote PDF, the event function sheet and the public sign page. Nothing is
 * re-formatted here, so what a caterer sees in-app is character-for-character what
 * the client will sign. Renders nothing when the booking has no courses — the flat
 * menu above it is then the whole story, exactly as before. */
export default function MenuAsClientSees({
  menuLines,
}: {
  menuLines: MenuLineGroup[] | null | undefined;
}) {
  if (!menuLines || menuLines.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-6" data-testid="menu-as-client-sees">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
          Menu as the client sees it
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          What prints on the proposal and the signing page.
        </p>
        <div className="space-y-3">
          {menuLines.map((group, i) => (
            <div key={i}>
              <h3 className="text-sm font-medium text-foreground">
                {group.name || "Additional dishes"}
              </h3>
              <ul className="mt-1 space-y-0.5">
                {/* Index key: two dishes in one course may share a name. */}
                {group.items.map((item, j) => (
                  <li key={j} className="text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
