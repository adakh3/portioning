"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Account, Contact } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const ROLE_LABELS: Record<string, string> = {
  decision_maker: "Decision Maker",
  coordinator: "Coordinator",
  billing: "Billing",
  onsite: "Onsite Contact",
};

export default function AccountDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<Partial<Account>>({});
  const [saving, setSaving] = useState(false);

  // Contact form
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactData, setContactData] = useState<Partial<Contact>>({
    name: "", email: "", phone: "", role: "coordinator", is_primary: false,
  });

  useEffect(() => {
    api.getAccount(Number(id))
      .then((data) => { setAccount(data); setFormData(data); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    if (!account) return;
    setSaving(true);
    try {
      const updated = await api.updateAccount(account.id, formData);
      setAccount(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setSaving(true);
    try {
      const contact = await api.createContact(account.id, contactData);
      setAccount({ ...account, contacts: [...account.contacts, contact] });
      setShowContactForm(false);
      setContactData({ name: "", email: "", phone: "", role: "coordinator", is_primary: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteContact(contactId: number) {
    if (!account || !confirm("Delete this contact?")) return;
    try {
      await api.deleteContact(account.id, contactId);
      setAccount({ ...account, contacts: account.contacts.filter((c) => c.id !== contactId) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;
  if (!account) return <p className="text-muted-foreground">Account not found.</p>;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/accounts">&larr; Back to Accounts</Link>
      </Button>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              {editing ? (
                <Input
                  type="text"
                  value={formData.name || ""}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="text-2xl font-bold h-auto py-1"
                />
              ) : (
                <h1 className="text-2xl font-bold text-foreground">{account.name}</h1>
              )}
              <p className="text-sm text-muted-foreground capitalize mt-1">{account.account_type} &middot; {account.payment_terms.replace("_", " ")}</p>
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button onClick={handleSave} disabled={saving} variant="success">
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button variant="outline" onClick={() => { setEditing(false); setFormData(account); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      if (confirm("Delete this account?")) {
                        await api.deleteAccount(account.id);
                        router.push("/accounts");
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
                <select value={formData.account_type} onChange={(e) => setFormData({ ...formData, account_type: e.target.value })} className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="individual">Individual</option>
                  <option value="company">Company</option>
                  <option value="agency">Agency</option>
                  <option value="venue">Venue</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Payment Terms</label>
                <select value={formData.payment_terms} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                  <option value="immediate">Immediate</option>
                  <option value="net_15">Net 15</option>
                  <option value="net_30">Net 30</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Billing City</label>
                <Input type="text" value={formData.billing_city || ""} onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">VAT Number</label>
                <Input type="text" value={formData.vat_number || ""} onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1">Notes</label>
                <Textarea value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
              {account.billing_city && <div><span className="text-muted-foreground">City:</span> {account.billing_city}</div>}
              {account.vat_number && <div><span className="text-muted-foreground">VAT:</span> {account.vat_number}</div>}
              {account.notes && <div className="md:col-span-2"><span className="text-muted-foreground">Notes:</span> {account.notes}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contacts */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">Contacts</h2>
            <Button onClick={() => setShowContactForm(!showContactForm)}>
              {showContactForm ? "Cancel" : "Add Contact"}
            </Button>
          </div>

          {showContactForm && (
            <form onSubmit={handleAddContact} className="border border-border rounded-md p-4 mb-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Name</label>
                  <Input type="text" required value={contactData.name || ""} onChange={(e) => setContactData({ ...contactData, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <Input type="email" value={contactData.email || ""} onChange={(e) => setContactData({ ...contactData, email: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                  <Input type="text" value={contactData.phone || ""} onChange={(e) => setContactData({ ...contactData, phone: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Role</label>
                  <select value={contactData.role} onChange={(e) => setContactData({ ...contactData, role: e.target.value })} className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="decision_maker">Decision Maker</option>
                    <option value="coordinator">Coordinator</option>
                    <option value="billing">Billing</option>
                    <option value="onsite">Onsite Contact</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={contactData.is_primary || false} onChange={(e) => setContactData({ ...contactData, is_primary: e.target.checked })} className="rounded border-input" />
                  <label className="text-sm text-foreground">Primary contact</label>
                </div>
              </div>
              <Button type="submit" disabled={saving} variant="success" className="mt-4">
                {saving ? "Adding..." : "Add Contact"}
              </Button>
            </form>
          )}

          {account.contacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No contacts yet.</p>
          ) : (
            <div className="space-y-3">
              {account.contacts.map((contact) => (
                <div key={contact.id} className="flex items-center justify-between border border-border rounded-md p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{contact.name}</span>
                      {contact.is_primary && <Badge variant="info">Primary</Badge>}
                      <span className="text-xs text-muted-foreground">{ROLE_LABELS[contact.role] || contact.role}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {contact.email && <span className="mr-4">{contact.email}</span>}
                      {contact.phone && <span>{contact.phone}</span>}
                    </div>
                  </div>
                  <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteContact(contact.id)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
