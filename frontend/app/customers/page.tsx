"use client";

import { useState } from "react";
import { api, Contact } from "@/lib/api";
import { useContacts, useAccounts } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const EMPTY = { name: "", phone: "", email: "", address: "", account: "" };

export default function CustomersPage() {
  const { data: customers = [], error: loadError, isLoading: loading, mutate } = useContacts();
  const { data: accounts = [] } = useAccounts();
  const businesses = accounts.filter((a) => a.account_type !== "individual");

  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(search) || c.email.toLowerCase().includes(q);
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setError("");
    setShowForm(true);
  }

  function openEdit(c: Contact) {
    setEditingId(c.id);
    setForm({
      name: c.name, phone: c.phone, email: c.email, address: c.address,
      account: c.account != null ? String(c.account) : "",
    });
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      account: form.account ? Number(form.account) : null,
    };
    try {
      if (editingId != null) await api.updateCustomer(editingId, payload);
      else await api.createCustomer(payload);
      await mutate();
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save customer");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading customers...</p>;
  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Customers</h1>
        <Button onClick={() => (showForm ? setShowForm(false) : openCreate())}>
          {showForm ? "Cancel" : "New Customer"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showForm && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              {editingId != null ? "Edit Customer" : "New Customer"}
            </h2>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
                  <Input type="text" required maxLength={200} value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone / WhatsApp</label>
                  <Input type="text" maxLength={50} value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <Input type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-foreground mb-1">Home address</label>
                  <Input type="text" value={form.address} placeholder="Used to prefill the venue for home events"
                    onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Business (optional)</label>
                  <select value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} className={selectClass}>
                    <option value="">-- None --</option>
                    {businesses.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={saving} variant="success" className="mt-4">
                {saving ? "Saving..." : editingId != null ? "Save Customer" : "Create Customer"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Input type="text" placeholder="Search by name, phone or email..." value={search}
        onChange={(e) => setSearch(e.target.value)} className="w-full md:w-80" />

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No customers found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <Card key={c.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => openEdit(c)}>
              <CardContent className="p-6">
                <h3 className="font-semibold text-foreground">{c.name}</h3>
                {c.phone && <p className="text-sm text-muted-foreground mt-1">{c.phone}</p>}
                {c.email && <p className="text-sm text-muted-foreground">{c.email}</p>}
                {c.address && <p className="text-sm text-muted-foreground mt-1">{c.address}</p>}
                {c.account != null && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {accounts.find((a) => a.id === c.account)?.name || "Business"}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
