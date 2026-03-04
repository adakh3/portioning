"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  CollisionDetection,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { api, Lead, LeadFilters } from "@/lib/api";
import { useLeads, useUsers, useProductLines, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Constants ──

const COLUMNS = [
  { status: "new", label: "New", color: "bg-primary", badge: "bg-white/20 text-white" },
  { status: "contacted", label: "Contacted", color: "bg-warning", badge: "bg-white/20 text-white" },
  { status: "qualified", label: "Qualified", color: "bg-info", badge: "bg-white/20 text-white" },
  { status: "converted", label: "Converted", color: "bg-success", badge: "bg-white/20 text-white" },
  { status: "lost", label: "Lost", color: "bg-muted", badge: "bg-foreground/10 text-foreground" },
] as const;

const COLUMN_IDS = new Set(COLUMNS.map((c) => c.status as string));

const EVENT_TYPES = [
  { value: "wedding", label: "Wedding" },
  { value: "corporate", label: "Corporate Event" },
  { value: "birthday", label: "Birthday Party" },
  { value: "funeral", label: "Funeral / Wake" },
  { value: "religious", label: "Religious Event" },
  { value: "social", label: "Social Gathering" },
  { value: "other", label: "Other" },
];

const STATUS_VARIANT: Record<string, "default" | "warning" | "info" | "success" | "secondary"> = {
  new: "default",
  contacted: "warning",
  qualified: "info",
  converted: "success",
  lost: "secondary",
};

type SortField = "contact_name" | "event_date" | "lead_date" | "guest_estimate" | "status" | "created_at";

const SORTABLE_COLUMNS: { field: SortField; label: string }[] = [
  { field: "contact_name", label: "Name" },
  { field: "event_date", label: "Event Date" },
  { field: "lead_date", label: "Lead Date" },
  { field: "guest_estimate", label: "Guests" },
  { field: "status", label: "Status" },
  { field: "created_at", label: "Created" },
];

// ── Collision detection for Kanban ──

const columnFirstCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const columnHit = pointerCollisions.find((c) => COLUMN_IDS.has(c.id as string));
  if (columnHit) return [columnHit];
  const rectCollisions = rectIntersection(args);
  const rectColumnHit = rectCollisions.find((c) => COLUMN_IDS.has(c.id as string));
  if (rectColumnHit) return [rectColumnHit];
  return pointerCollisions;
};

// ── Kanban components ──

function LeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const router = useRouter();

  return (
    <div
      onClick={() => !isDragging && router.push(`/leads/${lead.id}`)}
      className={cn(
        "bg-background border border-border rounded-lg p-3 cursor-pointer hover:border-primary/40 transition-colors",
        isDragging && "shadow-lg ring-2 ring-ring opacity-90"
      )}
    >
      <p className="font-medium text-sm text-foreground truncate">{lead.contact_name}</p>
      <p className="text-xs text-muted-foreground mt-1">
        {lead.event_type_display}
        {lead.event_date && ` · ${lead.event_date}`}
      </p>
      {lead.guest_estimate && (
        <p className="text-xs text-muted-foreground mt-0.5">{lead.guest_estimate} guests</p>
      )}
      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
        {lead.product_name && (
          <span className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">{lead.product_name}</span>
        )}
        {lead.assigned_to_name && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {lead.assigned_to_name}
          </Badge>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ lead }: { lead: Lead }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: lead.id.toString(), data: { lead } });

  const style: React.CSSProperties = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadCard lead={lead} />
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  color,
  badge,
  leads,
}: {
  status: string;
  label: string;
  color: string;
  badge: string;
  leads: Lead[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] flex-shrink-0">
      <div className={cn(color, "rounded-t-lg px-3 py-2 flex items-center justify-between")}>
        <span className={cn("text-sm font-semibold", color === "bg-muted" ? "text-muted-foreground" : "text-white")}>{label}</span>
        <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", badge)}>
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 bg-muted rounded-b-lg p-2 space-y-2 min-h-[200px] transition-colors",
          isOver && "bg-accent ring-2 ring-ring ring-inset"
        )}
      >
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No leads</p>
        )}
      </div>
    </div>
  );
}

// ── Sort header icon ──

function SortIcon({ field, current }: { field: string; current: string }) {
  if (!current.endsWith(field) && current !== `-${field}`) {
    return <span className="ml-1 text-muted-foreground/40">&#8597;</span>;
  }
  return <span className="ml-1">{current.startsWith("-") ? "\u2193" : "\u2191"}</span>;
}

// ── Main page ──

export default function LeadsPage() {
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [search, setSearch] = useState("");
  const [filterAssigned, setFilterAssigned] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterEventType, setFilterEventType] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterLeadDateFrom, setFilterLeadDateFrom] = useState("");
  const [filterLeadDateTo, setFilterLeadDateTo] = useState("");
  const [ordering, setOrdering] = useState("-created_at");

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Kanban state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [toast, setToast] = useState("");

  // Build filters for API
  const filters: LeadFilters = useMemo(() => {
    const f: LeadFilters = {};
    if (filterAssigned) f.assigned_to = filterAssigned;
    if (filterProduct) f.product = filterProduct;
    if (filterEventType) f.event_type = filterEventType;
    if (filterDateFrom) f.date_from = filterDateFrom;
    if (filterDateTo) f.date_to = filterDateTo;
    if (filterLeadDateFrom) f.lead_date_from = filterLeadDateFrom;
    if (filterLeadDateTo) f.lead_date_to = filterLeadDateTo;
    if (ordering) f.ordering = ordering;
    return f;
  }, [filterAssigned, filterProduct, filterEventType, filterDateFrom, filterDateTo, filterLeadDateFrom, filterLeadDateTo, ordering]);

  const { data: fetchedLeads, error: loadError, isLoading: loading } = useLeads(filters);
  const { data: users } = useUsers();
  const { data: productLines } = useProductLines();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    if (fetchedLeads) setLeads(fetchedLeads);
  }, [fetchedLeads]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear selection when data changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [fetchedLeads]);

  // Client-side text search filter (applied on top of server filters)
  const filtered = search
    ? leads.filter((l) =>
        l.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        l.event_type_display.toLowerCase().includes(search.toLowerCase()) ||
        l.contact_email.toLowerCase().includes(search.toLowerCase()) ||
        l.account_name?.toLowerCase().includes(search.toLowerCase())
      )
    : leads;

  const leadsByStatus = COLUMNS.reduce<Record<string, Lead[]>>((acc, col) => {
    acc[col.status] = filtered.filter((l) => l.status === col.status);
    return acc;
  }, {});

  const hasFilters = filterAssigned || filterProduct || filterEventType || filterDateFrom || filterDateTo || filterLeadDateFrom || filterLeadDateTo;

  function clearFilters() {
    setFilterAssigned("");
    setFilterProduct("");
    setFilterEventType("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterLeadDateFrom("");
    setFilterLeadDateTo("");
    setSearch("");
  }

  // ── Sort handling ──

  function toggleSort(field: SortField) {
    if (ordering === field) {
      setOrdering(`-${field}`);
    } else if (ordering === `-${field}`) {
      setOrdering(field);
    } else {
      setOrdering(field);
    }
  }

  // ── Selection handling ──

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((l) => l.id)));
    }
  }

  // ── Bulk actions ──

  async function executeBulkAction(action: string, value?: string | number | null) {
    setBulkLoading(true);
    try {
      await api.bulkUpdateLeads(Array.from(selectedIds), action, value);
      setSelectedIds(new Set());
      setBulkAction("");
      setBulkValue("");
      revalidate("leads");
      // Revalidate all filtered lead keys
      const qs = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&");
      if (qs) revalidate(`leads?${qs}`);
      setToast(`${action === "delete" ? "Deleted" : "Updated"} ${selectedIds.size} lead(s)`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkLoading(false);
      setShowDeleteConfirm(false);
    }
  }

  // ── Kanban drag ──

  function handleDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id.toString() === event.active.id);
    setActiveLead(lead || null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const lead = leads.find((l) => l.id.toString() === active.id);
    if (!lead) return;

    const targetStatus = over.id as string;
    if (!COLUMN_IDS.has(targetStatus) || targetStatus === lead.status) return;

    setLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id ? { ...l, status: targetStatus } : l
      )
    );

    try {
      await api.transitionLead(lead.id, targetStatus);
      revalidate("leads");
      const qs = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&");
      if (qs) revalidate(`leads?${qs}`);
    } catch (e: unknown) {
      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, status: lead.status } : l
        )
      );
      const msg = e instanceof Error ? e.message : "Transition failed";
      setToast(msg);
    }
  }

  if (loadError && !leads.length) return <p className="text-destructive">Error: {loadError.message}</p>;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-foreground shrink-0">Leads</h1>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border border-border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode("kanban")}
              className={cn(
                "px-2.5 py-1.5 text-sm",
                viewMode === "kanban" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              )}
              title="Kanban view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn(
                "px-2.5 py-1.5 text-sm",
                viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
              )}
              title="Table view"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
              </svg>
            </button>
          </div>
          <Button asChild>
            <Link href="/leads/new">New Lead</Link>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <Input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48"
        />
        <Select value={filterAssigned || "__all__"} onValueChange={(v) => setFilterAssigned(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Assigned To" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Users</SelectItem>
            {users?.map((u) => (
              <SelectItem key={u.id} value={u.id.toString()}>
                {u.first_name} {u.last_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterProduct || "__all__"} onValueChange={(v) => setFilterProduct(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Products</SelectItem>
            {productLines?.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterEventType || "__all__"} onValueChange={(v) => setFilterEventType(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Event Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            {EVENT_TYPES.map((et) => (
              <SelectItem key={et.value} value={et.value}>
                {et.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Event:</label>
          <Input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="w-36"
          />
          <span className="text-muted-foreground text-xs">-</span>
          <Input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-muted-foreground whitespace-nowrap">Lead:</label>
          <Input
            type="date"
            value={filterLeadDateFrom}
            onChange={(e) => setFilterLeadDateFrom(e.target.value)}
            className="w-36"
          />
          <span className="text-muted-foreground text-xs">-</span>
          <Input
            type="date"
            value={filterLeadDateTo}
            onChange={(e) => setFilterLeadDateTo(e.target.value)}
            className="w-36"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && viewMode === "table" && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-muted rounded-lg border border-border">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border" />

          {/* Assign */}
          <div className="flex items-center gap-1">
            <Select value={bulkAction === "assign" ? bulkValue : ""} onValueChange={(v) => { setBulkAction("assign"); setBulkValue(v); }}>
              <SelectTrigger className="w-36 h-8 text-xs">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassign</SelectItem>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id.toString()}>
                    {u.first_name} {u.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bulkAction === "assign" && bulkValue && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={bulkLoading}
                onClick={() => executeBulkAction("assign", bulkValue === "__none__" ? null : bulkValue)}
              >
                Apply
              </Button>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-1">
            <Select value={bulkAction === "status" ? bulkValue : ""} onValueChange={(v) => { setBulkAction("status"); setBulkValue(v); }}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue placeholder="Status..." />
              </SelectTrigger>
              <SelectContent>
                {COLUMNS.map((col) => (
                  <SelectItem key={col.status} value={col.status}>
                    {col.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bulkAction === "status" && bulkValue && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={bulkLoading}
                onClick={() => executeBulkAction("status", bulkValue)}
              >
                Apply
              </Button>
            )}
          </div>

          {/* Product */}
          <div className="flex items-center gap-1">
            <Select value={bulkAction === "product" ? bulkValue : ""} onValueChange={(v) => { setBulkAction("product"); setBulkValue(v); }}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue placeholder="Product..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No Product</SelectItem>
                {productLines?.map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bulkAction === "product" && bulkValue && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={bulkLoading}
                onClick={() => executeBulkAction("product", bulkValue === "__none__" ? null : bulkValue)}
              >
                Apply
              </Button>
            )}
          </div>

          <div className="h-4 w-px bg-border" />
          <Button
            size="sm"
            variant="destructive"
            className="h-8 text-xs"
            disabled={bulkLoading}
            onClick={() => setShowDeleteConfirm(true)}
          >
            Delete
          </Button>

          <button
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            Deselect all
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <p className="text-muted-foreground">Loading leads...</p>
      ) : viewMode === "kanban" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={columnFirstCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                status={col.status}
                label={col.label}
                color={col.color}
                badge={col.badge}
                leads={leadsByStatus[col.status] || []}
              />
            ))}
          </div>

          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <LeadsTable
          leads={filtered}
          selectedIds={selectedIds}
          ordering={ordering}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onToggleSort={toggleSort}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedIds.size} lead(s)?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected leads and their data will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkLoading}
              onClick={() => executeBulkAction("delete")}
            >
              {bulkLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Table view component ──

function LeadsTable({
  leads,
  selectedIds,
  ordering,
  onToggleSelect,
  onToggleSelectAll,
  onToggleSort,
}: {
  leads: Lead[];
  selectedIds: Set<number>;
  ordering: string;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onToggleSort: (field: SortField) => void;
}) {
  const router = useRouter();
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                className="rounded border-border"
              />
            </TableHead>
            <TableHead>
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("contact_name")}>
                Name <SortIcon field="contact_name" current={ordering} />
              </button>
            </TableHead>
            <TableHead className="hidden lg:table-cell">Email</TableHead>
            <TableHead className="hidden md:table-cell">Event Type</TableHead>
            <TableHead>
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("event_date")}>
                Event Date <SortIcon field="event_date" current={ordering} />
              </button>
            </TableHead>
            <TableHead className="hidden lg:table-cell">
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("lead_date")}>
                Lead Date <SortIcon field="lead_date" current={ordering} />
              </button>
            </TableHead>
            <TableHead>
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("guest_estimate")}>
                Guests <SortIcon field="guest_estimate" current={ordering} />
              </button>
            </TableHead>
            <TableHead className="hidden md:table-cell">Product</TableHead>
            <TableHead className="hidden lg:table-cell">Assigned</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead>
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("status")}>
                Status <SortIcon field="status" current={ordering} />
              </button>
            </TableHead>
            <TableHead className="hidden xl:table-cell">
              <button className="flex items-center hover:text-foreground" onClick={() => onToggleSort("created_at")}>
                Created <SortIcon field="created_at" current={ordering} />
              </button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={12} className="text-center text-muted-foreground py-12">
                No leads found
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                data-state={selectedIds.has(lead.id) ? "selected" : undefined}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => onToggleSelect(lead.id)}
                    className="rounded border-border"
                  />
                </TableCell>
                <TableCell
                  className="font-medium"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.contact_name}
                </TableCell>
                <TableCell
                  className="hidden lg:table-cell text-muted-foreground"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.contact_email || "-"}
                </TableCell>
                <TableCell
                  className="hidden md:table-cell"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.event_type_display}
                </TableCell>
                <TableCell onClick={() => router.push(`/leads/${lead.id}`)}>
                  {lead.event_date || "-"}
                </TableCell>
                <TableCell
                  className="hidden lg:table-cell"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.lead_date || "-"}
                </TableCell>
                <TableCell onClick={() => router.push(`/leads/${lead.id}`)}>
                  {lead.guest_estimate ?? "-"}
                </TableCell>
                <TableCell
                  className="hidden md:table-cell"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.product_name ? (
                    <span className="text-xs font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      {lead.product_name}
                    </span>
                  ) : "-"}
                </TableCell>
                <TableCell
                  className="hidden lg:table-cell"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.assigned_to_name || "-"}
                </TableCell>
                <TableCell
                  className="hidden md:table-cell capitalize"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.source}
                </TableCell>
                <TableCell onClick={() => router.push(`/leads/${lead.id}`)}>
                  <Badge variant={STATUS_VARIANT[lead.status] || "secondary"}>
                    {lead.status_display}
                  </Badge>
                </TableCell>
                <TableCell
                  className="hidden xl:table-cell text-muted-foreground text-xs"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {new Date(lead.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
