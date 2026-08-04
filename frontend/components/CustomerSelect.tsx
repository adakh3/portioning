"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useContacts } from "@/lib/hooks";
import SearchableSelect from "@/components/SearchableSelect";

/** Customer (person) picker with inline "create new". The new person is created
 * org-wide (no business required) and selected immediately.
 *
 * Searchable rather than a native select: the customer list is every person the
 * org has ever quoted, so it only grows. The requirement is enforced by the page's
 * submit handler, not an HTML `required` — this isn't a form control. */
export default function CustomerSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: contacts = [], mutate } = useContacts();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!form.first_name.trim()) {
      setError("First name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const c = await api.createCustomer({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(),
        phone: form.phone.trim(), address: form.address.trim(),
      });
      await mutate();
      onChange(String(c.id));
      setCreating(false);
      setForm({ first_name: "", last_name: "", phone: "", address: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create customer");
    } finally {
      setSaving(false);
    }
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
        <div className="flex gap-2">
          <input autoFocus type="text" placeholder="First name *" aria-label="First name" value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
            className="flex h-9 w-full min-w-[90px] rounded-md border border-input bg-background px-3 py-1 text-sm" />
          <input type="text" placeholder="Last name" aria-label="Last name" value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
            className="flex h-9 w-full min-w-[90px] rounded-md border border-input bg-background px-3 py-1 text-sm" />
        </div>
        <input type="tel" placeholder="Phone / WhatsApp" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" />
        <input type="text" placeholder="Home address (optional)" value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={create} disabled={saving}
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? "Adding…" : "Add customer"}
          </button>
          <button type="button" onClick={() => { setCreating(false); setError(""); }}
            className="rounded border border-input px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* The phone rides on the second line for everyone, not just when two people
          share a name — as a muted hint it costs nothing, and it makes the list
          searchable by number, which is how a caller is often identified. */}
      <SearchableSelect
        ariaLabel="Customer"
        placeholder="Search customers by name or phone…"
        emptyLabel="-- Select customer --"
        value={value}
        onChange={onChange}
        options={contacts.map((c) => ({ value: String(c.id), label: c.name, hint: c.phone || undefined }))}
      />
      <button type="button" onClick={() => setCreating(true)}
        className="mt-1 text-xs text-primary hover:underline">+ New customer</button>
    </div>
  );
}
