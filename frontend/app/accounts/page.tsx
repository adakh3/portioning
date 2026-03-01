"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, Account } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

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

  if (loading) return <p className="text-muted-foreground">Loading accounts...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Accounts</h1>
        <Button
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "New Account"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name</label>
              <Input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Type</label>
              <select
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value })}
                className="w-full border border-input rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="individual">Individual</option>
                <option value="company">Company</option>
                <option value="agency">Agency</option>
                <option value="venue">Venue</option>
              </select>
            </div>
          </div>
          <Button
            type="submit"
            disabled={saving}
            variant="success"
            className="mt-4"
          >
            {saving ? "Creating..." : "Create Account"}
          </Button>
        </form>
      )}

      <Input
        type="text"
        placeholder="Search accounts..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full md:w-80 mb-4"
      />

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No accounts found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((account) => (
            <Link
              key={account.id}
              href={`/accounts/${account.id}`}
              className="block"
            >
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground">{account.name}</h3>
                      <p className="text-sm text-muted-foreground capitalize">{account.account_type}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{account.contacts.length} contacts</span>
                  </div>
                  {account.billing_city && (
                    <p className="text-sm text-muted-foreground mt-2">{account.billing_city}</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
