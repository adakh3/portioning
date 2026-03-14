"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Customer } from "@/lib/api";
import { useCustomer, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: customer, error: loadError, isLoading: loading, mutate: mutateCustomer } = useCustomer(Number(id) || null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<Customer>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) setFormData(customer);
  }, [customer]);

  async function handleSave() {
    if (!customer) return;
    if (!formData.name?.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    try {
      await api.updateCustomer(customer.id, formData);
      await mutateCustomer();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;
  if (!customer) return <p className="text-muted-foreground">Customer not found.</p>;

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/customers" className="text-primary hover:underline">&larr; Customers</Link>
        <span className="text-muted-foreground">&middot;</span>
        <span className="text-muted-foreground">{customer.display_name}</span>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              {editing ? (
                <ValidatedInput
                  type="text"
                  required
                  maxLength={200}
                  value={formData.name || ""}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="text-2xl font-bold h-auto py-1"
                  placeholder="Name"
                />
              ) : (
                <h1 className="text-2xl font-bold text-foreground">{customer.display_name}</h1>
              )}
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={customer.customer_type === "business" ? "info" : "secondary"}>
                  {customer.customer_type}
                </Badge>
                <span className="text-sm text-muted-foreground">{customer.payment_terms.replace("_", " ")}</span>
              </div>
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button onClick={handleSave} disabled={saving} variant="success">
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" onClick={() => { setEditing(false); setFormData(customer); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                  <Button
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      if (confirm("Delete this customer?")) {
                        await api.deleteCustomer(customer.id);
                        revalidate("customers");
                        router.push("/customers");
                      }
                    }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Type</label>
                <select value={formData.customer_type} onChange={(e) => setFormData({ ...formData, customer_type: e.target.value })} className={selectClass}>
                  <option value="consumer">Consumer</option>
                  <option value="business">Business</option>
                </select>
              </div>
              {(formData.customer_type === "business") && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Company Name</label>
                  <ValidatedInput type="text" maxLength={200} value={formData.company_name || ""} onChange={(e) => setFormData({ ...formData, company_name: e.target.value })} />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                <ValidatedInput type="email" maxLength={254} value={formData.email || ""} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                <ValidatedInput type="tel" maxLength={50} value={formData.phone || ""} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Payment Terms</label>
                <select value={formData.payment_terms} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} className={selectClass}>
                  <option value="immediate">Immediate</option>
                  <option value="net_15">Net 15</option>
                  <option value="net_30">Net 30</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Billing City</label>
                <ValidatedInput type="text" maxLength={100} value={formData.billing_city || ""} onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">VAT Number</label>
                <ValidatedInput type="text" maxLength={50} value={formData.vat_number || ""} onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                <Textarea maxLength={5000} value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
              {customer.customer_type === "business" && customer.company_name && (
                <div><span className="text-muted-foreground">Company:</span> {customer.company_name}</div>
              )}
              {customer.customer_type === "business" && customer.name && (
                <div><span className="text-muted-foreground">Contact:</span> {customer.name}</div>
              )}
              {customer.email && <div><span className="text-muted-foreground">Email:</span> {customer.email}</div>}
              {customer.phone && <div><span className="text-muted-foreground">Phone:</span> {customer.phone}</div>}
              {customer.billing_city && <div><span className="text-muted-foreground">City:</span> {customer.billing_city}</div>}
              {customer.vat_number && <div><span className="text-muted-foreground">VAT:</span> {customer.vat_number}</div>}
              {customer.notes && <div className="md:col-span-2"><span className="text-muted-foreground">Notes:</span> {customer.notes}</div>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
