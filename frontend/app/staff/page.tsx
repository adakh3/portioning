"use client";

import { useEffect, useState } from "react";
import { api, StaffMember, LaborRole } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Tab = "roster" | "roles";

export default function StaffPage() {
  const [tab, setTab] = useState<Tab>("roster");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Staff</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        <button
          onClick={() => setTab("roster")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "roster"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Staff Roster
        </button>
        <button
          onClick={() => setTab("roles")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "roles"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Labour Roles
        </button>
      </div>

      {tab === "roster" ? <StaffRosterTab /> : <LabourRolesTab />}
    </div>
  );
}

function StaffRosterTab() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<LaborRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<StaffMember>>({
    name: "",
    email: "",
    phone: "",
    roles: [],
    hourly_rate: "",
  });
  const [editFormData, setEditFormData] = useState<Partial<StaffMember>>({});

  useEffect(() => {
    Promise.all([api.getStaff(), api.getLaborRoles()])
      .then(([staffData, rolesData]) => {
        setStaff(staffData);
        setRoles(rolesData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = staff.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.email.toLowerCase().includes(search.toLowerCase())
  );

  function toggleRole(roleId: number, current: number[]): number[] {
    return current.includes(roleId)
      ? current.filter((r) => r !== roleId)
      : [...current, roleId];
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const member = await api.createStaffMember(formData);
      setStaff((prev) => [member, ...prev]);
      setShowForm(false);
      setFormData({ name: "", email: "", phone: "", roles: [], hourly_rate: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff member");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateStaffMember(id, editFormData);
      setStaff((prev) => prev.map((s) => (s.id === id ? updated : s)));
      setExpandedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update staff member");
    } finally {
      setSaving(false);
    }
  }

  function expandCard(member: StaffMember) {
    if (expandedId === member.id) {
      setExpandedId(null);
    } else {
      setEditFormData({
        name: member.name,
        email: member.email,
        phone: member.phone,
        roles: [...member.roles],
        hourly_rate: member.hourly_rate || "",
      });
      setExpandedId(member.id);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading staff...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-80"
        />
        <Button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", email: "", phone: "", roles: [], hourly_rate: "" });
          }}
          className="ml-4 whitespace-nowrap"
        >
          {showForm ? "Cancel" : "Add Staff"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
              <Input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Email</label>
              <Input
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
              <Input
                type="text"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Hourly Rate</label>
              <Input
                type="number"
                step="0.01"
                value={formData.hourly_rate || ""}
                onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground mb-2">Roles</label>
              <div className="flex flex-wrap gap-3">
                {roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-1.5 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={(formData.roles || []).includes(role.id)}
                      onChange={() =>
                        setFormData({ ...formData, roles: toggleRole(role.id, formData.roles || []) })
                      }
                      className="rounded border-input"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              type="submit"
              disabled={saving}
              variant="success"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">No staff members found.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((member) => (
            <Card key={member.id}>
              <CardContent className="pt-4 pb-4">
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => expandCard(member)}
                >
                  <div>
                    <h3 className="font-semibold text-foreground">{member.name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {member.email && <span className="text-sm text-muted-foreground">{member.email}</span>}
                      {member.phone && <span className="text-sm text-muted-foreground">{member.phone}</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {member.role_names.map((rn) => (
                        <Badge key={rn} variant="info">
                          {rn}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    {member.hourly_rate && (
                      <span className="text-sm font-medium text-foreground">
                        {"\u00A3"}{parseFloat(member.hourly_rate).toFixed(2)}/hr
                      </span>
                    )}
                    <Button
                      variant="link"
                      className="block p-0 h-auto mt-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        expandCard(member);
                      }}
                    >
                      {expandedId === member.id ? "Close" : "Edit"}
                    </Button>
                  </div>
                </div>

                {expandedId === member.id && (
                  <form
                    onSubmit={(e) => handleUpdate(member.id, e)}
                    className="mt-4 pt-4 border-t border-border"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
                        <Input
                          type="text"
                          required
                          value={editFormData.name || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                        <Input
                          type="email"
                          value={editFormData.email || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                        <Input
                          type="text"
                          value={editFormData.phone || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Hourly Rate</label>
                        <Input
                          type="number"
                          step="0.01"
                          value={editFormData.hourly_rate || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, hourly_rate: e.target.value })
                          }
                          placeholder="0.00"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-foreground mb-2">Roles</label>
                        <div className="flex flex-wrap gap-3">
                          {roles.map((role) => (
                            <label
                              key={role.id}
                              className="flex items-center gap-1.5 text-sm text-foreground"
                            >
                              <input
                                type="checkbox"
                                checked={(editFormData.roles || []).includes(role.id)}
                                onChange={() =>
                                  setEditFormData({
                                    ...editFormData,
                                    roles: toggleRole(role.id, editFormData.roles || []),
                                  })
                                }
                                className="rounded border-input"
                              />
                              {role.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button
                        type="submit"
                        disabled={saving}
                        variant="success"
                      >
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setExpandedId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function LabourRolesTab() {
  const [roles, setRoles] = useState<LaborRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<LaborRole>>({
    name: "",
    default_hourly_rate: "",
    description: "",
  });
  const [editFormData, setEditFormData] = useState<Partial<LaborRole>>({});

  useEffect(() => {
    api
      .getLaborRoles()
      .then(setRoles)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const role = await api.createLaborRole(formData);
      setRoles((prev) => [role, ...prev]);
      setShowForm(false);
      setFormData({ name: "", default_hourly_rate: "", description: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateLaborRole(id, editFormData);
      setRoles((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(role: LaborRole) {
    if (editingId === role.id) {
      setEditingId(null);
    } else {
      setEditFormData({
        name: role.name,
        default_hourly_rate: role.default_hourly_rate,
        description: role.description,
      });
      setEditingId(role.id);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading roles...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", default_hourly_rate: "", description: "" });
          }}
        >
          {showForm ? "Cancel" : "Add Role"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
              <Input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Default Hourly Rate *</label>
              <Input
                type="number"
                step="0.01"
                required
                value={formData.default_hourly_rate || ""}
                onChange={(e) =>
                  setFormData({ ...formData, default_hourly_rate: e.target.value })
                }
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Description</label>
              <Input
                type="text"
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              type="submit"
              disabled={saving}
              variant="success"
            >
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {roles.length === 0 ? (
        <p className="text-muted-foreground">No labour roles defined.</p>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardContent className="pt-4 pb-4">
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => startEdit(role)}
                >
                  <div>
                    <h3 className="font-semibold text-foreground">{role.name}</h3>
                    {role.description && (
                      <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-foreground">
                      {"\u00A3"}{parseFloat(role.default_hourly_rate).toFixed(2)}/hr
                    </span>
                    <Button
                      variant="link"
                      className="block p-0 h-auto mt-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(role);
                      }}
                    >
                      {editingId === role.id ? "Close" : "Edit"}
                    </Button>
                  </div>
                </div>

                {editingId === role.id && (
                  <form
                    onSubmit={(e) => handleUpdate(role.id, e)}
                    className="mt-4 pt-4 border-t border-border"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Name *</label>
                        <Input
                          type="text"
                          required
                          value={editFormData.name || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, name: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          Default Hourly Rate *
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          required
                          value={editFormData.default_hourly_rate || ""}
                          onChange={(e) =>
                            setEditFormData({
                              ...editFormData,
                              default_hourly_rate: e.target.value,
                            })
                          }
                          placeholder="0.00"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">
                          Description
                        </label>
                        <Input
                          type="text"
                          value={editFormData.description || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, description: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button
                        type="submit"
                        disabled={saving}
                        variant="success"
                      >
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
