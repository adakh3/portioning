"use client";

import { useState } from "react";
import { api, StaffMember, LaborRole, AllocationRule } from "@/lib/api";
import { useStaff, useLaborRoles, useAllocationRules, useEventTypes } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

type Tab = "roster" | "roles" | "allocation";

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
        <button
          onClick={() => setTab("allocation")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "allocation"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Allocation Rules
        </button>
      </div>

      {tab === "roster" ? (
        <StaffRosterTab />
      ) : tab === "roles" ? (
        <LabourRolesTab />
      ) : (
        <AllocationRulesTab />
      )}
    </div>
  );
}

function StaffRosterTab() {
  const { data: staff = [], error: loadError, isLoading: loading, mutate: mutateStaff } = useStaff();
  const { data: roles = [] } = useLaborRoles();
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
      await api.createStaffMember(formData);
      mutateStaff();
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
      await api.updateStaffMember(id, editFormData);
      mutateStaff();
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
  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

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
                        {formatCurrency(member.hourly_rate)}/hr
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
  const { data: roles = [], error: loadError, isLoading: loading, mutate: mutateRoles } = useLaborRoles();
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createLaborRole(formData);
      mutateRoles();
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
      await api.updateLaborRole(id, editFormData);
      mutateRoles();
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
  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

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
                      {formatCurrency(role.default_hourly_rate)}/hr
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

function AllocationRulesTab() {
  const { data: rules = [], error: loadError, isLoading: loading, mutate: mutateRules } = useAllocationRules();
  const { data: roles = [] } = useLaborRoles();
  const { data: eventTypes = [] } = useEventTypes();
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<Partial<AllocationRule>>({
    role: undefined,
    event_type: "",
    guests_per_staff: 30,
    minimum_staff: 1,
  });
  const [editFormData, setEditFormData] = useState<Partial<AllocationRule>>({});

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.createAllocationRule(formData);
      mutateRules();
      setShowForm(false);
      setFormData({ role: undefined, event_type: "", guests_per_staff: 30, minimum_staff: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number, e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.updateAllocationRule(id, editFormData);
      mutateRules();
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rule");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this allocation rule?")) return;
    try {
      await api.deleteAllocationRule(id);
      mutateRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rule");
    }
  }

  function startEdit(rule: AllocationRule) {
    if (editingId === rule.id) {
      setEditingId(null);
    } else {
      setEditFormData({
        role: rule.role,
        event_type: rule.event_type,
        guests_per_staff: rule.guests_per_staff,
        minimum_staff: rule.minimum_staff,
        is_active: rule.is_active,
      });
      setEditingId(rule.id);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading allocation rules...</p>;
  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">
        Define how many staff of each role are needed per number of guests.
      </p>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      <div className="flex justify-end mb-4">
        <Button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ role: undefined, event_type: "", guests_per_staff: 30, minimum_staff: 1 });
          }}
        >
          {showForm ? "Cancel" : "Add Rule"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-background border border-border rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Role *</label>
              <select
                required
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.role || ""}
                onChange={(e) => setFormData({ ...formData, role: Number(e.target.value) })}
              >
                <option value="">Select role...</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.event_type || ""}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
              >
                <option value="">All event types</option>
                {eventTypes.map((et) => (
                  <option key={et.value} value={et.value}>{et.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Guests per Staff *</label>
              <Input
                type="number"
                required
                min={1}
                value={formData.guests_per_staff || ""}
                onChange={(e) => setFormData({ ...formData, guests_per_staff: Number(e.target.value) })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Minimum Staff</label>
              <Input
                type="number"
                min={1}
                value={formData.minimum_staff || 1}
                onChange={(e) => setFormData({ ...formData, minimum_staff: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button type="submit" disabled={saving} variant="success">
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {rules.length === 0 ? (
        <p className="text-muted-foreground">No allocation rules defined.</p>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="pt-4 pb-4">
                <div
                  className="flex items-start justify-between cursor-pointer"
                  onClick={() => startEdit(rule)}
                >
                  <div>
                    <h3 className="font-semibold text-foreground">{rule.role_name}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      1 per {rule.guests_per_staff} guests
                      {rule.event_type ? ` (${rule.event_type})` : " (all events)"}
                      {" \u00B7 "}min {rule.minimum_staff}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!rule.is_active && (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                    <Button
                      variant="link"
                      className="p-0 h-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(rule);
                      }}
                    >
                      {editingId === rule.id ? "Close" : "Edit"}
                    </Button>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(rule.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {editingId === rule.id && (
                  <form
                    onSubmit={(e) => handleUpdate(rule.id, e)}
                    className="mt-4 pt-4 border-t border-border"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Role *</label>
                        <select
                          required
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={editFormData.role || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, role: Number(e.target.value) })}
                        >
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                        <select
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={editFormData.event_type || ""}
                          onChange={(e) => setEditFormData({ ...editFormData, event_type: e.target.value })}
                        >
                          <option value="">All event types</option>
                          {eventTypes.map((et) => (
                            <option key={et.value} value={et.value}>{et.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Guests per Staff *</label>
                        <Input
                          type="number"
                          required
                          min={1}
                          value={editFormData.guests_per_staff || ""}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, guests_per_staff: Number(e.target.value) })
                          }
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">Minimum Staff</label>
                        <Input
                          type="number"
                          min={1}
                          value={editFormData.minimum_staff || 1}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, minimum_staff: Number(e.target.value) })
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                      <label className="flex items-center gap-1.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={editFormData.is_active !== false}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, is_active: e.target.checked })
                          }
                          className="rounded border-input"
                        />
                        Active
                      </label>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button type="submit" disabled={saving} variant="success">
                        {saving ? "Saving..." : "Save"}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setEditingId(null)}>
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
