"use client";

import { useEffect, useState } from "react";
import { api, StaffMember, LaborRole } from "@/lib/api";

type Tab = "roster" | "roles";

export default function StaffPage() {
  const [tab, setTab] = useState<Tab>("roster");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
      </div>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <button
          onClick={() => setTab("roster")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "roster"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Staff Roster
        </button>
        <button
          onClick={() => setTab("roles")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "roles"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
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

  if (loading) return <p className="text-gray-500">Loading staff...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-80 border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
        />
        <button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", email: "", phone: "", roles: [], hourly_rate: "" });
          }}
          className="ml-4 bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 whitespace-nowrap"
        >
          {showForm ? "Cancel" : "Add Staff"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email || ""}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate</label>
              <input
                type="number"
                step="0.01"
                value={formData.hourly_rate || ""}
                onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
              <div className="flex flex-wrap gap-3">
                {roles.map((role) => (
                  <label key={role.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={(formData.roles || []).includes(role.id)}
                      onChange={() =>
                        setFormData({ ...formData, roles: toggleRole(role.id, formData.roles || []) })
                      }
                      className="rounded border-gray-300"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-gray-500">No staff members found.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((member) => (
            <div key={member.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div
                className="flex items-start justify-between cursor-pointer"
                onClick={() => expandCard(member)}
              >
                <div>
                  <h3 className="font-semibold text-gray-900">{member.name}</h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                    {member.email && <span className="text-sm text-gray-500">{member.email}</span>}
                    {member.phone && <span className="text-sm text-gray-500">{member.phone}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {member.role_names.map((rn) => (
                      <span
                        key={rn}
                        className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded"
                      >
                        {rn}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  {member.hourly_rate && (
                    <span className="text-sm font-medium text-gray-700">
                      {"\u00A3"}{parseFloat(member.hourly_rate).toFixed(2)}/hr
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      expandCard(member);
                    }}
                    className="block text-blue-600 text-sm hover:underline mt-1"
                  >
                    {expandedId === member.id ? "Close" : "Edit"}
                  </button>
                </div>
              </div>

              {expandedId === member.id && (
                <form
                  onSubmit={(e) => handleUpdate(member.id, e)}
                  className="mt-4 pt-4 border-t border-gray-100"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={editFormData.name || ""}
                        onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                      <input
                        type="email"
                        value={editFormData.email || ""}
                        onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                      <input
                        type="text"
                        value={editFormData.phone || ""}
                        onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editFormData.hourly_rate || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, hourly_rate: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Roles</label>
                      <div className="flex flex-wrap gap-3">
                        {roles.map((role) => (
                          <label
                            key={role.id}
                            className="flex items-center gap-1.5 text-sm text-gray-700"
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
                              className="rounded border-gray-300"
                            />
                            {role.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
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

  if (loading) return <p className="text-gray-500">Loading roles...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => {
            setShowForm(!showForm);
            setFormData({ name: "", default_hourly_rate: "", description: "" });
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "Add Role"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default Hourly Rate *</label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.default_hourly_rate || ""}
                onChange={(e) =>
                  setFormData({ ...formData, default_hourly_rate: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input
                type="text"
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {roles.length === 0 ? (
        <p className="text-gray-500">No labour roles defined.</p>
      ) : (
        <div className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div
                className="flex items-start justify-between cursor-pointer"
                onClick={() => startEdit(role)}
              >
                <div>
                  <h3 className="font-semibold text-gray-900">{role.name}</h3>
                  {role.description && (
                    <p className="text-sm text-gray-500 mt-0.5">{role.description}</p>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-sm font-medium text-gray-700">
                    {"\u00A3"}{parseFloat(role.default_hourly_rate).toFixed(2)}/hr
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(role);
                    }}
                    className="block text-blue-600 text-sm hover:underline mt-1"
                  >
                    {editingId === role.id ? "Close" : "Edit"}
                  </button>
                </div>
              </div>

              {editingId === role.id && (
                <form
                  onSubmit={(e) => handleUpdate(role.id, e)}
                  className="mt-4 pt-4 border-t border-gray-100"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={editFormData.name || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, name: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Default Hourly Rate *
                      </label>
                      <input
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
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Description
                      </label>
                      <input
                        type="text"
                        value={editFormData.description || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, description: e.target.value })
                        }
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
