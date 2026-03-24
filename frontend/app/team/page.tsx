"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ManagedUser, ProductLine } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useProductLines } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLES = [
  { value: "salesperson", label: "Salesperson" },
  { value: "manager", label: "Manager" },
  { value: "chef", label: "Chef" },
  { value: "owner", label: "Owner" },
];

const roleBadgeVariant: Record<string, "default" | "secondary" | "info" | "warning"> = {
  owner: "default",
  manager: "info",
  salesperson: "secondary",
  chef: "warning",
};

export default function TeamPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: productLines = [] } = useProductLines();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", role: "salesperson", password: "", product_lines: [] as number[] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [initialForm, setInitialForm] = useState({ first_name: "", last_name: "", email: "", role: "salesperson", password: "", product_lines: [] as number[] });

  // Redirect non-owners
  useEffect(() => {
    if (user && user.role !== "owner") {
      router.replace("/");
    }
  }, [user, router]);

  async function loadUsers() {
    try {
      const data = await api.getOrgUsers();
      setUsers(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadUsers(); }, []);

  function openCreate() {
    setEditingUser(null);
    setForm({ first_name: "", last_name: "", email: "", role: "salesperson", password: "", product_lines: [] });
    setError("");
    setDialogOpen(true);
  }

  function openEdit(u: ManagedUser) {
    setEditingUser(u);
    const formData = { first_name: u.first_name, last_name: u.last_name, email: u.email, role: u.role, password: "", product_lines: u.product_lines || [] };
    setForm(formData);
    setInitialForm(formData);
    setError("");
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          role: form.role,
          product_lines: form.product_lines,
        };
        if (form.password) payload.password = form.password;
        await api.updateUser(editingUser.id, payload as Partial<ManagedUser & { password?: string }>);
      } else {
        if (!form.password) { setError("Password is required for new users."); setSaving(false); return; }
        await api.createUser(form);
      }
      setDialogOpen(false);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: ManagedUser) {
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      loadUsers();
    } catch { /* ignore */ }
  }

  if (user?.role !== "owner") return null;

  return (
    <div>
      <Button variant="link" asChild className="mb-4 p-0 h-auto">
        <Link href="/">&larr; Home</Link>
      </Button>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Team</h1>
        <Button onClick={openCreate}>Add User</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-muted-foreground">Loading...</p>
          ) : users.length === 0 ? (
            <p className="p-6 text-muted-foreground">No team members yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.first_name} {u.last_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={roleBadgeVariant[u.role] || "secondary"} className="text-xs">
                        {ROLES.find((r) => r.value === u.role)?.label || u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(u.product_line_names || []).map((name) => (
                          <span key={name} className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">{name}</span>
                        ))}
                        {(!u.product_line_names || u.product_line_names.length === 0) && (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {u.is_active ? (
                        <Badge variant="success" className="text-xs">Active</Badge>
                      ) : (
                        <Badge variant="destructive" className="text-xs">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                          Edit
                        </Button>
                        {u.id !== user?.id && (
                          <Button
                            variant={u.is_active ? "outline" : "default"}
                            size="sm"
                            onClick={() => toggleActive(u)}
                          >
                            {u.is_active ? "Deactivate" : "Activate"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {error && <p className="text-destructive text-sm">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">First Name *</label>
                <Input
                  value={form.first_name}
                  onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, first_name: v })); }}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Last Name *</label>
                <Input
                  value={form.last_name}
                  onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, last_name: v })); }}
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email *</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, email: v })); }}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Role *</label>
              <select
                value={form.role}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, role: v })); }}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            {productLines.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Product Lines</label>
                <div className="flex flex-wrap gap-2">
                  {productLines.map((pl) => {
                    const selected = form.product_lines.includes(pl.id);
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => setForm((f) => ({
                          ...f,
                          product_lines: f.product_lines.includes(pl.id)
                            ? f.product_lines.filter((id) => id !== pl.id)
                            : [...f.product_lines, pl.id],
                        }))}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-transparent text-muted-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        {pl.name}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Click to toggle. Used for lead assignment and filtering.</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Password {editingUser ? "(leave blank to keep current)" : "*"}
              </label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, password: v })); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.first_name || !form.last_name || !form.email || (editingUser && JSON.stringify(form) === JSON.stringify(initialForm))}
            >
              {saving ? "Saving..." : editingUser ? "Save Changes" : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
