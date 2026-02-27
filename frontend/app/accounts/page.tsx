"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Account } from "@/lib/api";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: "", account_type: "individual" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAccounts()
      .then(setAccounts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = accounts.filter(
    (a) => a.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const account = await api.createAccount(formData);
      setAccounts((prev) => [account, ...prev]);
      setShowForm(false);
      setFormData({ name: "", account_type: "individual" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading accounts...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "New Account"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              >
                <option value="individual">Individual</option>
                <option value="company">Company</option>
                <option value="agency">Agency</option>
                <option value="venue">Venue</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mt-4 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Account"}
          </button>
        </form>
      )}

      <input
        type="text"
        placeholder="Search accounts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-80 border border-gray-300 rounded px-3 py-2 text-sm mb-4 focus:ring-1 focus:ring-blue-500"
      />

      {filtered.length === 0 ? (
        <p className="text-gray-500">No accounts found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((account) => (
            <Link
              key={account.id}
              href={`/accounts/${account.id}`}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{account.name}</h3>
                  <p className="text-sm text-gray-500 capitalize">{account.account_type}</p>
                </div>
                <span className="text-xs text-gray-400">{account.contacts.length} contacts</span>
              </div>
              {account.billing_city && (
                <p className="text-sm text-gray-500 mt-2">{account.billing_city}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
