"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Account, Contact } from "@/lib/api";

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

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;
  if (!account) return <p className="text-gray-500">Account not found.</p>;

  return (
    <div>
      <Link href="/accounts" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        &larr; Back to Accounts
      </Link>

      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            {editing ? (
              <input
                type="text"
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="text-2xl font-bold border border-gray-300 rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <h1 className="text-2xl font-bold text-gray-900">{account.name}</h1>
            )}
            <p className="text-sm text-gray-500 capitalize mt-1">{account.account_type} &middot; {account.payment_terms.replace("_", " ")}</p>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={handleSave} disabled={saving} className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50">
                  {saving ? "Saving..." : "Save"}
                </button>
                <button onClick={() => { setEditing(false); setFormData(account); }} className="border border-gray-300 px-3 py-1.5 rounded text-sm hover:bg-gray-50">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditing(true)} className="border border-gray-300 px-3 py-1.5 rounded text-sm hover:bg-gray-50">
                  Edit
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Delete this account?")) {
                      await api.deleteAccount(account.id);
                      router.push("/accounts");
                    }
                  }}
                  className="border border-red-300 text-red-600 px-3 py-1.5 rounded text-sm hover:bg-red-50"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {editing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select value={formData.account_type} onChange={(e) => setFormData({ ...formData, account_type: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="individual">Individual</option>
                <option value="company">Company</option>
                <option value="agency">Agency</option>
                <option value="venue">Venue</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Terms</label>
              <select value={formData.payment_terms} onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                <option value="immediate">Immediate</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing City</label>
              <input type="text" value={formData.billing_city || ""} onChange={(e) => setFormData({ ...formData, billing_city: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
              <input type="text" value={formData.vat_number || ""} onChange={(e) => setFormData({ ...formData, vat_number: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={formData.notes || ""} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
            {account.billing_city && <div><span className="text-gray-500">City:</span> {account.billing_city}</div>}
            {account.vat_number && <div><span className="text-gray-500">VAT:</span> {account.vat_number}</div>}
            {account.notes && <div className="md:col-span-2"><span className="text-gray-500">Notes:</span> {account.notes}</div>}
          </div>
        )}
      </div>

      {/* Contacts */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Contacts</h2>
          <button onClick={() => setShowContactForm(!showContactForm)} className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700">
            {showContactForm ? "Cancel" : "Add Contact"}
          </button>
        </div>

        {showContactForm && (
          <form onSubmit={handleAddContact} className="border border-gray-200 rounded p-4 mb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" required value={contactData.name || ""} onChange={(e) => setContactData({ ...contactData, name: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={contactData.email || ""} onChange={(e) => setContactData({ ...contactData, email: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={contactData.phone || ""} onChange={(e) => setContactData({ ...contactData, phone: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select value={contactData.role} onChange={(e) => setContactData({ ...contactData, role: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2 text-sm">
                  <option value="decision_maker">Decision Maker</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="billing">Billing</option>
                  <option value="onsite">Onsite Contact</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={contactData.is_primary || false} onChange={(e) => setContactData({ ...contactData, is_primary: e.target.checked })} className="rounded border-gray-300" />
                <label className="text-sm text-gray-700">Primary contact</label>
              </div>
            </div>
            <button type="submit" disabled={saving} className="mt-4 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {saving ? "Adding..." : "Add Contact"}
            </button>
          </form>
        )}

        {account.contacts.length === 0 ? (
          <p className="text-gray-500 text-sm">No contacts yet.</p>
        ) : (
          <div className="space-y-3">
            {account.contacts.map((contact) => (
              <div key={contact.id} className="flex items-center justify-between border border-gray-100 rounded p-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{contact.name}</span>
                    {contact.is_primary && <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">Primary</span>}
                    <span className="text-xs text-gray-400">{ROLE_LABELS[contact.role] || contact.role}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {contact.email && <span className="mr-4">{contact.email}</span>}
                    {contact.phone && <span>{contact.phone}</span>}
                  </div>
                </div>
                <button onClick={() => handleDeleteContact(contact.id)} className="text-red-500 hover:text-red-700 text-sm">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
