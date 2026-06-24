"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/** Superuser-only org impersonation: pick which org's data the whole app shows.
 * Renders nothing for normal users. Backed by the session org-override. */
export default function OrgSwitcher() {
  const { user, switchOrg } = useAuth();
  const [orgs, setOrgs] = useState<{ id: number; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.is_superuser) {
      api.getOrganisations().then(setOrgs).catch(() => setOrgs([]));
    }
  }, [user?.is_superuser]);

  if (!user?.is_superuser) return null;

  const current = user.organisation?.name ?? "Pick an org";

  async function choose(orgId: number | null) {
    setOpen(false);
    setBusy(true);
    try {
      await switchOrg(orgId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-warning/40 bg-warning/10 text-foreground hover:bg-warning/20 disabled:opacity-60"
        title="Superuser — switch the org you're viewing"
      >
        <span className="text-muted-foreground">Viewing:</span>
        <span className="font-medium max-w-[140px] truncate">{busy ? "Switching…" : current}</span>
        <span className="text-muted-foreground">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 w-56 max-h-80 overflow-auto rounded-md border border-border bg-popover shadow-md p-1">
            <p className="text-xs text-muted-foreground px-2 py-1">View one organisation</p>
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => choose(o.id)}
                className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted truncate ${
                  user.organisation?.id === o.id ? "font-semibold" : ""
                }`}
              >
                {o.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
