"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useAccounts } from "@/lib/hooks";
import SearchableSelect from "@/components/SearchableSelect";

/** Business (company) picker with inline "create new". Only real businesses
 * (non-individual) are listed; new ones are created as type "company".
 *
 * Searchable rather than a native select, like the customer picker beside it —
 * a corporate caterer's account list grows without bound. The requirement is
 * enforced by the page's submit handler, not an HTML `required`. */
export default function BusinessSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: accounts = [], mutate } = useAccounts();
  const businesses = accounts.filter((a) => a.account_type !== "individual");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("company");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const a = await api.createAccount({ name: name.trim(), account_type: type });
      await mutate();
      onChange(String(a.id));
      setCreating(false);
      setName("");
      setType("company");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create business");
    } finally {
      setSaving(false);
    }
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
        <input autoFocus type="text" placeholder="Business name *" value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" />
        <select value={type} onChange={(e) => setType(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
          <option value="company">Company</option>
          <option value="agency">Agency</option>
          <option value="venue">Venue</option>
        </select>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={create} disabled={saving}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Adding…" : "Add business"}
          </button>
          <button type="button" onClick={() => { setCreating(false); setError(""); }}
            className="rounded border border-input px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SearchableSelect
        ariaLabel="Business"
        placeholder="Search businesses…"
        emptyLabel="-- Select business --"
        value={value}
        onChange={onChange}
        options={businesses.map((a) => ({ value: String(a.id), label: a.name }))}
      />
      <button type="button" onClick={() => setCreating(true)}
        className="mt-1 text-xs text-primary hover:underline">+ New business</button>
    </div>
  );
}
