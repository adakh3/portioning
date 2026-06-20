"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useContacts } from "@/lib/hooks";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Customer (person) picker with inline "create new". The new person is created
 * org-wide (no business required) and selected immediately. */
export default function CustomerSelect({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const { data: contacts = [], mutate } = useContacts();
  // Only show the phone as a tiebreaker when two customers share a name.
  const nameCounts = contacts.reduce<Record<string, number>>((m, c) => {
    m[c.name] = (m[c.name] || 0) + 1;
    return m;
  }, {});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const c = await api.createCustomer({ name: form.name.trim(), phone: form.phone.trim() });
      await mutate();
      onChange(String(c.id));
      setCreating(false);
      setForm({ name: "", phone: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create customer");
    } finally {
      setSaving(false);
    }
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
        <input autoFocus type="text" placeholder="Name *" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" />
        <input type="tel" placeholder="Phone / WhatsApp" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
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
      <select required={required} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        <option value="">-- Select customer --</option>
        {contacts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{nameCounts[c.name] > 1 && c.phone ? ` — ${c.phone}` : ""}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setCreating(true)}
        className="mt-1 text-xs text-primary hover:underline">+ New customer</button>
    </div>
  );
}
