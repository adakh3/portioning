"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { useCustomers } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function CustomersPage() {
  const { data: customers = [], error: loadError, isLoading: loading, mutate: mutateCustomers } = useCustomers();
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", customer_type: "consumer", company_name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.company_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createCustomer(formData);
      await mutateCustomers();
      setShowForm(false);
      setFormData({ name: "", customer_type: "consumer", company_name: "", email: "", phone: "" });
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
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "New Customer"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleCreate}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
                  <Input
                    type="text"
                    required
                    maxLength={200}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={formData.customer_type === "business" ? "Contact person name" : "Full name"}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                  <select
                    value={formData.customer_type}
                    onChange={(e) => setFormData({ ...formData, customer_type: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="consumer">Consumer</option>
                    <option value="business">Business</option>
                  </select>
                </div>
                {formData.customer_type === "business" && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">Company Name</label>
                    <Input
                      type="text"
                      maxLength={200}
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <ValidatedInput type="email" maxLength={254} value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                  <ValidatedInput type="tel" maxLength={50} value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
                </div>
              </div>
              <Button type="submit" disabled={saving} variant="success" className="mt-4">
                {saving ? "Creating..." : "Create Customer"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Input
        type="text"
        placeholder="Search customers..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-80"
      />

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No customers found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((customer) => (
            <Link key={customer.id} href={`/customers/${customer.id}`} className="block">
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{customer.display_name}</h3>
                      {customer.customer_type === "business" && customer.name && (
                        <p className="text-sm text-muted-foreground">{customer.name}</p>
                      )}
                    </div>
                    <Badge variant={customer.customer_type === "business" ? "info" : "secondary"}>
                      {customer.customer_type}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 space-y-0.5">
                    {customer.email && <p>{customer.email}</p>}
                    {customer.billing_city && <p>{customer.billing_city}</p>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
