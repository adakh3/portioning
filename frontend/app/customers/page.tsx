"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useContacts, useAccounts } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function CustomersPage() {
  const { data: customers = [], error: loadError, isLoading: loading, mutate } = useContacts();
  const { data: accounts = [] } = useAccounts();
  const businesses = accounts.filter((a) => a.account_type !== "individual");

  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", account: "" });

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.phone.includes(search) || c.email.toLowerCase().includes(q);
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createCustomer({
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
        account: form.account ? Number(form.account) : null,
      });
      await mutate();
      setShowForm(false);
      setForm({ name: "", phone: "", email: "", address: "", account: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create customer");
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
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? "Cancel" : "New Customer"}</Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showForm && (
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleCreate}>
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
                {saving ? "Creating..." : "Create Customer"}
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
            <Card key={c.id}>
              <CardContent className="p-6">
                <h3 className="font-semibold text-foreground">{c.name}</h3>
                {c.phone && <p className="text-sm text-muted-foreground mt-1">{c.phone}</p>}
                {c.email && <p className="text-sm text-muted-foreground">{c.email}</p>}
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
