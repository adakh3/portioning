"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { api, Lead, LeadFilters, AuthUser, ProductLine, ChoiceOption } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useKanbanData, useLeadsPaginated, useUsers, useProductLines, useEventTypes, useLeadStatuses, useLostReasons, useDateFormat, revalidate } from "@/lib/hooks";
import { formatDate } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
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
import { useQueryState, useClearQueryState } from "@/lib/useQueryState";

// ── Constants ──

const COLUMNS = [
  { status: "new", label: "New", color: "bg-primary", badge: "bg-white/20 text-white" },
  { status: "contacted", label: "Contacted", color: "bg-warning", badge: "bg-white/20 text-white" },
  { status: "qualified", label: "Qualified", color: "bg-info", badge: "bg-white/20 text-white" },
  { status: "proposal_sent", label: "Proposal Sent", color: "bg-violet-500", badge: "bg-white/20 text-white" },
  { status: "won", label: "Won", color: "bg-success", badge: "bg-white/20 text-white" },
  { status: "lost", label: "Lost", color: "bg-muted", badge: "bg-foreground/10 text-foreground" },
] as const;

const COLUMN_IDS = new Set(COLUMNS.map((c) => c.status as string));

const STATUS_VARIANT: Record<string, "default" | "warning" | "info" | "success" | "secondary"> = {
  new: "default",
  contacted: "warning",
  qualified: "info",
  proposal_sent: "info",
  won: "success",
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
  const dateFormat = useDateFormat();

  return (
    <div
      onClick={() => !isDragging && router.push(`/leads/${lead.id}`)}
      className={cn(
        "bg-background border border-border rounded-lg p-3 cursor-pointer hover:border-primary/40 transition-colors",
        isDragging && "shadow-lg ring-2 ring-ring opacity-90"
      )}
    >
      <div className="flex items-center gap-1.5">
        <p className="font-medium text-sm text-foreground truncate">{lead.contact_name}</p>
        {lead.has_unread_whatsapp && (
          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500" title="Unread WhatsApp message" />
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {lead.event_type_display}
        {lead.event_date && ` · ${formatDate(lead.event_date, dateFormat)}`}
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
  count,
  hasMore,
  loadMore,
  loadingMore,
  optimisticLeads,
}: {
  status: string;
  label: string;
  color: string;
  badge: string;
  leads: Lead[];
  count: number;
  hasMore?: boolean;
  loadMore?: () => void;
  loadingMore?: boolean;
  optimisticLeads?: Lead[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  // Merge optimistic leads (dropped into this column) with server leads
  const allLeads = optimisticLeads
    ? [...optimisticLeads.filter((ol) => !leads.some((l) => l.id === ol.id)), ...leads]
    : leads;

  return (
    <div className="flex flex-col min-w-[200px] flex-1">
      <div className={cn(color, "rounded-t-lg px-3 py-2 flex items-center justify-between")}>
        <span className={cn("text-sm font-semibold", color === "bg-muted" ? "text-muted-foreground" : "text-white")}>{label}</span>
        <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full", badge)}>
          {count}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 bg-muted rounded-b-lg p-2 space-y-2 min-h-[200px] transition-colors",
          isOver && "bg-accent ring-2 ring-ring ring-inset"
        )}
      >
        {allLeads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} />
        ))}
        {allLeads.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">No leads</p>
        )}
        {hasMore && loadMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full text-xs text-primary hover:text-primary/80 py-2 text-center disabled:opacity-50"
          >
            {loadingMore ? "Loading..." : `Load more (${count - allLeads.length} remaining)`}
          </button>
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
  return (
    <Suspense>
      <LeadsContent />
    </Suspense>
  );
}

function LeadsContent() {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const isSalesperson = currentUser?.role === "salesperson";
  const dateFormat = useDateFormat();
  const [viewModeRaw, setViewMode] = useQueryState("view", "kanban");
  const viewMode = (viewModeRaw === "table" ? "table" : "kanban") as "kanban" | "table";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce search input for server-side filtering
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [filterAssigned, setFilterAssigned] = useQueryState("assigned", "");
  const [filterStatus, setFilterStatus] = useQueryState("status", "");
  const [filterProduct, setFilterProduct] = useQueryState("product", "");
  const [filterEventType, setFilterEventType] = useQueryState("eventType", "");
  const [filterDateFrom, setFilterDateFrom] = useQueryState("dateFrom", "");
  const [filterDateTo, setFilterDateTo] = useQueryState("dateTo", "");
  const [filterLeadDateFrom, setFilterLeadDateFrom] = useQueryState("leadDateFrom", "");
  const [filterLeadDateTo, setFilterLeadDateTo] = useQueryState("leadDateTo", "");
  const [ordering, setOrdering] = useQueryState("sort", "-created_at");

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Kanban state
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [toast, setToast] = useState("");
  // Optimistic moves: leads temporarily added to a column after drag
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, Lead[]>>({});

  // Table pagination
  const [tablePage, setTablePage] = useState(1);

  // Lost reason dialog state
  const [pendingLostLeadId, setPendingLostLeadId] = useState<number | null>(null);
  const [lostReasonId, setLostReasonId] = useState<number | null>(null);
  const [lostNotesInput, setLostNotesInput] = useState("");
  const [lostSaving, setLostSaving] = useState(false);

  // Won dialog state
  const [pendingWonLeadId, setPendingWonLeadId] = useState<number | null>(null);
  const [wonSaving, setWonSaving] = useState(false);

  // Build filters for API (without status — Kanban columns add their own)
  const baseFilters: LeadFilters = useMemo(() => {
    const f: LeadFilters = {};
    if (filterAssigned) f.assigned_to = filterAssigned;
    if (filterStatus) f.status = filterStatus;
    if (filterProduct) f.product = filterProduct;
    if (filterEventType) f.event_type = filterEventType;
    if (filterDateFrom) f.date_from = filterDateFrom;
    if (filterDateTo) f.date_to = filterDateTo;
    if (filterLeadDateFrom) f.lead_date_from = filterLeadDateFrom;
    if (filterLeadDateTo) f.lead_date_to = filterLeadDateTo;
    if (ordering) f.ordering = ordering;
    if (debouncedSearch) f.search = debouncedSearch;
    return f;
  }, [filterAssigned, filterStatus, filterProduct, filterEventType, filterDateFrom, filterDateTo, filterLeadDateFrom, filterLeadDateTo, ordering, debouncedSearch]);

  // Alias for table use
  const filters = baseFilters;

  // ── Single-endpoint Kanban data (paused when in table view) ──
  const kanbanPaused = viewMode !== "kanban";
  const { data: kanbanData, isLoading: kanbanIsLoading, revalidate: revalidateKanban } = useKanbanData(baseFilters, kanbanPaused);

  // Per-column "Load more" extra leads state
  const [extraLeads, setExtraLeads] = useState<Record<string, Lead[]>>({});
  const [loadingMoreCol, setLoadingMoreCol] = useState<Record<string, boolean>>({});
  const pageRefs = useRef<Record<string, number>>({});

  // Reset extras when kanban data changes (filters changed, revalidation)
  const prevKanbanKeyRef = useRef<string | null>(null);
  const kanbanKeyStr = JSON.stringify(baseFilters);
  if (prevKanbanKeyRef.current !== kanbanKeyStr) {
    prevKanbanKeyRef.current = kanbanKeyStr;
    setExtraLeads({});
    pageRefs.current = {};
  }

  const loadMoreForColumn = useCallback(async (colStatus: string) => {
    if (loadingMoreCol[colStatus]) return;
    setLoadingMoreCol((prev) => ({ ...prev, [colStatus]: true }));
    try {
      const nextPage = (pageRefs.current[colStatus] || 1) + 1;
      const resp = await api.getLeadsPaginated({ ...baseFilters, status: colStatus, page_size: 20, page: nextPage });
      pageRefs.current[colStatus] = nextPage;
      setExtraLeads((prev) => ({
        ...prev,
        [colStatus]: [...(prev[colStatus] || []), ...resp.results],
      }));
    } finally {
      setLoadingMoreCol((prev) => ({ ...prev, [colStatus]: false }));
    }
  }, [loadingMoreCol, baseFilters]);

  // Build columnData from kanban response + extra leads
  const columnData = useMemo(() => {
    const result: Record<string, { leads: Lead[]; count: number; hasMore: boolean; loadMore: () => void; loadingMore: boolean }> = {};
    for (const col of COLUMNS) {
      const colInfo = kanbanData?.columns[col.status];
      const serverLeads = colInfo?.results || [];
      const extras = extraLeads[col.status] || [];
      const allLeads = [...serverLeads, ...extras];
      const count = colInfo?.count ?? 0;
      result[col.status] = {
        leads: allLeads,
        count,
        hasMore: allLeads.length < count,
        loadMore: () => loadMoreForColumn(col.status),
        loadingMore: !!loadingMoreCol[col.status],
      };
    }
    return result;
  }, [kanbanData, extraLeads, loadingMoreCol, loadMoreForColumn]);

  // ── Table data (paginated) ──
  const tableFilters: LeadFilters = useMemo(
    () => ({ ...baseFilters, page_size: 50, page: tablePage }),
    [baseFilters, tablePage],
  );
  const { data: tableData, error: tableError, isLoading: tableLoading } = useLeadsPaginated(tableFilters, viewMode !== "table");
  const tableLeads = tableData?.results || [];
  const tableCount = tableData?.count ?? 0;
  const tableTotalPages = Math.max(1, Math.ceil(tableCount / 50));

  // Reset table page when filters change
  useEffect(() => {
    setTablePage(1);
  }, [filterAssigned, filterStatus, filterProduct, filterEventType, filterDateFrom, filterDateTo, filterLeadDateFrom, filterLeadDateTo, ordering, debouncedSearch]);

  const { data: users } = useUsers();
  const { data: productLines } = useProductLines();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: leadStatuses = [] } = useLeadStatuses();
  const { data: lostReasons = [] } = useLostReasons();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Clear selection when table data changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [tableData]);

  // Kanban loading state
  const kanbanLoading = viewMode === "kanban" && kanbanIsLoading;
  const loadError = viewMode === "kanban" ? undefined : tableError;
  const loading = viewMode === "kanban" ? kanbanLoading : tableLoading;

  function revalidateAllLeads() {
    // Revalidate kanban (single key) + table
    revalidateKanban();
    setExtraLeads({});
    pageRefs.current = {};
    revalidate("leads-paginated");
    const qs = Object.entries(baseFilters)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    if (qs) revalidate(`leads-paginated?${qs}`);
  }

  const hasFilters = search || filterAssigned || filterStatus || filterProduct || filterEventType || filterDateFrom || filterDateTo || filterLeadDateFrom || filterLeadDateTo;

  const clearQueryFilters = useClearQueryState(["assigned", "status", "product", "eventType", "dateFrom", "dateTo", "leadDateFrom", "leadDateTo"]);
  function clearFilters() {
    clearQueryFilters();
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
    if (selectedIds.size === tableLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tableLeads.map((l) => l.id)));
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
      revalidateAllLeads();
      setToast(`${action === "delete" ? "Deleted" : "Updated"} ${selectedIds.size} lead(s)`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkLoading(false);
      setShowDeleteConfirm(false);
    }
  }

  // ── Kanban drag ──

  function findLeadById(id: string): Lead | undefined {
    for (const col of Object.values(columnData)) {
      const found = col.leads.find((l) => l.id.toString() === id);
      if (found) return found;
    }
    return undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const lead = findLeadById(event.active.id as string);
    setActiveLead(lead || null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const lead = findLeadById(active.id as string);
    if (!lead) return;

    const targetStatus = over.id as string;
    if (!COLUMN_IDS.has(targetStatus) || targetStatus === lead.status) return;

    // Intercept lost transitions — show dialog
    if (targetStatus === "lost") {
      setPendingLostLeadId(lead.id);
      return;
    }

    // Intercept won transitions — show dialog
    if (targetStatus === "won") {
      setPendingWonLeadId(lead.id);
      return;
    }

    // Optimistic: show lead in target column immediately
    const movedLead = { ...lead, status: targetStatus };
    setOptimisticMoves((prev) => ({
      ...prev,
      [targetStatus]: [...(prev[targetStatus] || []), movedLead],
    }));

    try {
      await api.transitionLead(lead.id, targetStatus);
      // Clear optimistic state and revalidate both source + target columns
      setOptimisticMoves((prev) => {
        const next = { ...prev };
        if (next[targetStatus]) {
          next[targetStatus] = next[targetStatus].filter((l) => l.id !== lead.id);
          if (next[targetStatus].length === 0) delete next[targetStatus];
        }
        return next;
      });
      revalidateAllLeads();
    } catch (e: unknown) {
      // Revert optimistic move
      setOptimisticMoves((prev) => {
        const next = { ...prev };
        if (next[targetStatus]) {
          next[targetStatus] = next[targetStatus].filter((l) => l.id !== lead.id);
          if (next[targetStatus].length === 0) delete next[targetStatus];
        }
        return next;
      });
      const msg = e instanceof Error ? e.message : "Transition failed";
      setToast(msg);
    }
  }

  async function handleConfirmLost() {
    if (!pendingLostLeadId || !lostReasonId) return;
    setLostSaving(true);
    try {
      await api.transitionLead(pendingLostLeadId, "lost", {
        lost_reason_option: lostReasonId,
        lost_notes: lostNotesInput,
      });
      revalidateAllLeads();
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : "Failed to mark lost");
    } finally {
      setPendingLostLeadId(null);
      setLostReasonId(null);
      setLostNotesInput("");
      setLostSaving(false);
    }
  }

  async function handleConfirmWon(createEvent: boolean) {
    if (!pendingWonLeadId) return;
    setWonSaving(true);
    try {
      const updated = await api.markLeadWon(pendingWonLeadId, { create_event: createEvent });
      revalidateAllLeads();
      if (createEvent && updated.won_event) {
        router.push(`/events/${updated.won_event}`);
      }
    } catch (e: unknown) {
      setToast(e instanceof Error ? e.message : "Failed to mark won");
    } finally {
      setPendingWonLeadId(null);
      setWonSaving(false);
    }
  }

  if (loadError) return <p className="text-destructive">Error: {loadError.message}</p>;

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

      {/* Filter bar — collapses when bulk actions are active */}
      {selectedIds.size > 0 && viewMode === "table" ? (
        hasFilters ? (
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <span>Filters active</span>
            <span className="text-border">|</span>
            <button className="hover:text-foreground underline" onClick={() => setSelectedIds(new Set())}>
              Show filters
            </button>
          </div>
        ) : null
      ) : (
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <ValidatedInput
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
          {!isSalesperson && (
            <Select value={filterAssigned || "__all__"} onValueChange={(v) => setFilterAssigned(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Assigned To" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Users</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id.toString()}>
                    {u.first_name} {u.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={filterStatus || "__all__"} onValueChange={(v) => setFilterStatus(v === "__all__" ? "" : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Statuses</SelectItem>
              {leadStatuses.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
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
              {eventTypes.map((et) => (
                <SelectItem key={et.value} value={et.value}>
                  {et.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Event:</label>
            <ValidatedInput type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className={`w-36 ${!filterDateFrom ? "text-muted-foreground/50" : ""}`} />
            <span className="text-muted-foreground text-xs">-</span>
            <ValidatedInput type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className={`w-36 ${!filterDateTo ? "text-muted-foreground/50" : ""}`} />
            {(filterDateFrom || filterDateTo) && (
              <button type="button" onClick={() => { setFilterDateFrom(""); setFilterDateTo(""); }}
                className="text-muted-foreground hover:text-foreground text-xs px-1" title="Clear event dates">&times;</button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Lead:</label>
            <ValidatedInput type="date" value={filterLeadDateFrom} onChange={(e) => setFilterLeadDateFrom(e.target.value)} className={`w-36 ${!filterLeadDateFrom ? "text-muted-foreground/50" : ""}`} />
            <span className="text-muted-foreground text-xs">-</span>
            <ValidatedInput type="date" value={filterLeadDateTo} onChange={(e) => setFilterLeadDateTo(e.target.value)} className={`w-36 ${!filterLeadDateTo ? "text-muted-foreground/50" : ""}`} />
            {(filterLeadDateFrom || filterLeadDateTo) && (
              <button type="button" onClick={() => { setFilterLeadDateFrom(""); setFilterLeadDateTo(""); }}
                className="text-muted-foreground hover:text-foreground text-xs px-1" title="Clear lead dates">&times;</button>
            )}
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && viewMode === "table" && (
        <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-primary/10 rounded-lg border border-primary/30">
          <span className="text-sm font-semibold text-primary">Actions:</span>
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

          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 text-xs"
            onClick={() => setSelectedIds(new Set())}
          >
            Deselect all
          </Button>
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
            {COLUMNS.map((col) => {
              const cd = columnData[col.status];
              return (
                <KanbanColumn
                  key={col.status}
                  status={col.status}
                  label={col.label}
                  color={col.color}
                  badge={col.badge}
                  leads={cd?.leads || []}
                  count={cd?.count ?? 0}
                  hasMore={cd?.hasMore}
                  loadMore={cd?.loadMore}
                  loadingMore={cd?.loadingMore}
                  optimisticLeads={optimisticMoves[col.status]}
                />
              );
            })}
          </div>

          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} isDragging /> : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <>
          <LeadsTable
            leads={tableLeads}
            selectedIds={selectedIds}
            ordering={ordering}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            onToggleSort={toggleSort}
            users={users || []}
            productLines={productLines || []}
            filters={filters}
            onToast={setToast}
            onRevalidate={revalidateAllLeads}
            onMarkLost={(leadId) => setPendingLostLeadId(leadId)}
            onMarkWon={(leadId) => setPendingWonLeadId(leadId)}
          />
          {/* Pagination controls */}
          {tableTotalPages > 1 && (
            <div className="flex items-center justify-between mt-3 px-2">
              <p className="text-sm text-muted-foreground">
                {tableCount} lead{tableCount !== 1 ? "s" : ""} total
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tablePage <= 1}
                  onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {tablePage} of {tableTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={tablePage >= tableTotalPages}
                  onClick={() => setTablePage((p) => Math.min(tableTotalPages, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
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

      {/* Lost reason dialog */}
      <Dialog
        open={pendingLostLeadId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingLostLeadId(null);
            setLostReasonId(null);
            setLostNotesInput("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Lead as Lost</DialogTitle>
            <DialogDescription>
              Select a reason for losing this lead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-sm font-medium mb-1">Reason *</label>
              <select
                value={lostReasonId ?? ""}
                onChange={(e) => setLostReasonId(e.target.value ? Number(e.target.value) : null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">-- Select reason --</option>
                {lostReasons.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes (optional)</label>
              <Textarea
                value={lostNotesInput}
                onChange={(e) => setLostNotesInput(e.target.value)}
                rows={3}
                placeholder="Additional details..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPendingLostLeadId(null); setLostReasonId(null); setLostNotesInput(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!lostReasonId || lostSaving}
              onClick={handleConfirmLost}
            >
              {lostSaving ? "Saving..." : "Mark Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Won dialog */}
      <Dialog
        open={pendingWonLeadId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingWonLeadId(null);
        }}
      >
        <DialogContent className="border-success/30">
          <div className="text-center pt-2">
            <div className="text-5xl mb-3">&#127881;</div>
            <DialogHeader className="text-center">
              <DialogTitle className="text-xl text-center">Congratulations!</DialogTitle>
              <DialogDescription className="text-center">
                You&apos;re about to close this deal. What&apos;s next?
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex flex-col gap-3 py-3">
            <button
              disabled={wonSaving}
              onClick={() => handleConfirmWon(true)}
              className="w-full text-left p-4 rounded-lg border-2 border-success/30 bg-success/5 hover:bg-success/10 hover:border-success/50 transition-colors disabled:opacity-50"
            >
              <div className="font-semibold text-foreground">Create Event Now</div>
              <div className="text-sm text-muted-foreground mt-0.5">Set up the event straight away</div>
            </button>
            <button
              disabled={wonSaving}
              onClick={() => handleConfirmWon(false)}
              className="w-full text-left p-4 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <div className="font-semibold text-foreground">Mark as Won</div>
              <div className="text-sm text-muted-foreground mt-0.5">I&apos;ll create the event later</div>
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingWonLeadId(null)}>
              Cancel
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
  users,
  productLines,
  filters,
  onToast,
  onRevalidate,
  onMarkLost,
  onMarkWon,
}: {
  leads: Lead[];
  selectedIds: Set<number>;
  ordering: string;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onToggleSort: (field: SortField) => void;
  users: AuthUser[];
  productLines: ProductLine[];
  filters: LeadFilters;
  onToast: (msg: string) => void;
  onRevalidate: () => void;
  onMarkLost: (leadId: number) => void;
  onMarkWon: (leadId: number) => void;
}) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: leadStatuses = [] } = useLeadStatuses();
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;

  // Inline editing state
  const [editing, setEditing] = useState<{ leadId: number; field: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState<{ leadId: number; field: string } | null>(null);

  // Quick-add state
  const [quickAdd, setQuickAdd] = useState<Partial<Lead>>({});
  const [quickAddActive, setQuickAddActive] = useState(false);
  const [quickAddSaving, setQuickAddSaving] = useState(false);

  const isEditing = (field: string, leadId: number) =>
    editing?.leadId === leadId && editing?.field === field;
  const isSaving = (field: string, leadId: number) =>
    saving?.leadId === leadId && saving?.field === field;

  function revalidateLeads() {
    onRevalidate();
  }

  async function saveQuickAdd() {
    if (!quickAdd.contact_name?.trim()) {
      onToast("Name is required");
      return;
    }
    setQuickAddSaving(true);
    try {
      await api.createLead(quickAdd);
      revalidateLeads();
      setQuickAdd({});
      setQuickAddActive(false);
      onToast("Lead created");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed to create lead");
    } finally {
      setQuickAddSaving(false);
    }
  }

  function cancelQuickAdd() {
    setQuickAdd({});
    setQuickAddActive(false);
  }

  function startEdit(leadId: number, field: string, currentValue: string) {
    setEditing({ leadId, field });
    setDraft(currentValue);
  }

  async function commitEdit(leadId: number, field: string, value: string) {
    setEditing(null);
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    // Skip if unchanged
    const current = String(lead[field as keyof Lead] ?? "");
    if (value === current) return;

    setSaving({ leadId, field });
    try {
      if (field === "status") {
        if (value === "lost") {
          setSaving(null);
          onMarkLost(leadId);
          return;
        }
        if (value === "won") {
          setSaving(null);
          onMarkWon(leadId);
          return;
        }
        await api.transitionLead(leadId, value);
      } else if (field === "guest_estimate") {
        const parsed = value === "" ? null : parseInt(value, 10);
        if (parsed !== null && isNaN(parsed)) {
          onToast("Invalid guest count");
          return;
        }
        await api.updateLead(leadId, { guest_estimate: parsed });
      } else if (field === "assigned_to") {
        const numVal = value === "" ? null : parseInt(value, 10);
        await api.updateLead(leadId, { assigned_to: numVal } as Partial<Lead>);
      } else if (field === "product") {
        const numVal = value === "" ? null : parseInt(value, 10);
        await api.updateLead(leadId, { product: numVal } as Partial<Lead>);
      } else if (field === "event_type") {
        await api.updateLead(leadId, { event_type: value });
      } else if (field === "event_date") {
        await api.updateLead(leadId, { event_date: value || null });
      } else {
        await api.updateLead(leadId, { [field]: value });
      }
      revalidateLeads();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Failed to save");
      revalidateLeads();
    } finally {
      setSaving(null);
    }
  }

  // Editable text cell (name, date, guests)
  function EditableTextCell({
    lead,
    field,
    display,
    className,
    type = "text",
    title,
  }: {
    lead: Lead;
    field: string;
    display: string;
    className?: string;
    type?: string;
    title?: string;
  }) {
    if (isSaving(field, lead.id)) {
      return (
        <TableCell className={className}>
          <span className="text-xs text-muted-foreground italic">Saving...</span>
        </TableCell>
      );
    }
    if (isEditing(field, lead.id)) {
      return (
        <TableCell className={className} onClick={(e) => e.stopPropagation()}>
          <ValidatedInput
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit(lead.id, field, draft);
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => commitEdit(lead.id, field, draft)}
            autoFocus
            className="h-7 text-sm w-full min-w-0"
          />
        </TableCell>
      );
    }
    return (
      <TableCell
        className={cn(className, "cursor-pointer hover:underline decoration-dotted underline-offset-4")}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          startEdit(lead.id, field, String(lead[field as keyof Lead] ?? ""));
        }}
      >
        {display}
      </TableCell>
    );
  }

  // Editable select cell (event_type, product, assigned_to, status)
  function EditableSelectCell({
    lead,
    field,
    display,
    options,
    className,
    allowClear,
  }: {
    lead: Lead;
    field: string;
    display: React.ReactNode;
    options: { value: string; label: string }[];
    className?: string;
    allowClear?: boolean;
  }) {
    if (isSaving(field, lead.id)) {
      return (
        <TableCell className={className}>
          <span className="text-xs text-muted-foreground italic">Saving...</span>
        </TableCell>
      );
    }
    if (isEditing(field, lead.id)) {
      return (
        <TableCell className={className} onClick={(e) => e.stopPropagation()}>
          <Select
            defaultOpen
            value={draft}
            onValueChange={(v) => {
              const val = v === "__clear__" ? "" : v;
              commitEdit(lead.id, field, val);
            }}
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
          >
            <SelectTrigger className="h-7 text-sm w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowClear && <SelectItem value="__clear__">&mdash;</SelectItem>}
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
      );
    }
    return (
      <TableCell
        className={cn(className, "cursor-pointer hover:underline decoration-dotted underline-offset-4")}
        onClick={(e) => {
          e.stopPropagation();
          startEdit(lead.id, field, String(lead[field as keyof Lead] ?? ""));
        }}
      >
        {display}
      </TableCell>
    );
  }

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
            <TableHead className="hidden xl:table-cell min-w-[180px]">Notes</TableHead>
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
          {/* Quick Add row */}
          {!quickAddActive ? (
            <TableRow
              className="bg-muted/30 hover:bg-muted/50 cursor-pointer"
              onClick={() => setQuickAddActive(true)}
            >
              <TableCell colSpan={13} className="text-muted-foreground text-sm py-2">
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Quick add lead...
                </span>
              </TableCell>
            </TableRow>
          ) : (
            <TableRow className="bg-muted/50">
              {/* Actions */}
              <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-0.5">
                  <button
                    className="text-primary hover:text-primary/80 disabled:opacity-50"
                    onClick={saveQuickAdd}
                    disabled={quickAddSaving}
                    title="Save (Enter)"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={cancelQuickAdd}
                    title="Cancel (Esc)"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </TableCell>
              {/* Name */}
              <TableCell>
                <ValidatedInput
                  placeholder="Name *"
                  value={quickAdd.contact_name || ""}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, contact_name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveQuickAdd();
                    if (e.key === "Escape") cancelQuickAdd();
                  }}
                  autoFocus
                  disabled={quickAddSaving}
                  className="h-7 text-sm"
                />
              </TableCell>
              {/* Email */}
              <TableCell className="hidden lg:table-cell">
                <ValidatedInput
                  type="email"
                  placeholder="Email"
                  value={quickAdd.contact_email || ""}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, contact_email: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveQuickAdd();
                    if (e.key === "Escape") cancelQuickAdd();
                  }}
                  disabled={quickAddSaving}
                  className="h-7 text-sm"
                />
              </TableCell>
              {/* Event Type */}
              <TableCell className="hidden md:table-cell">
                <Select
                  value={quickAdd.event_type || ""}
                  onValueChange={(v) => setQuickAdd((p) => ({ ...p, event_type: v }))}
                >
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    {eventTypes.map((et) => (
                      <SelectItem key={et.value} value={et.value}>{et.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              {/* Event Date */}
              <TableCell>
                <ValidatedInput
                  type="date"
                  value={quickAdd.event_date || ""}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, event_date: e.target.value || null }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveQuickAdd();
                    if (e.key === "Escape") cancelQuickAdd();
                  }}
                  disabled={quickAddSaving}
                  className="h-7 text-sm"
                />
              </TableCell>
              {/* Lead Date */}
              <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">—</TableCell>
              {/* Guests */}
              <TableCell>
                <ValidatedInput
                  type="number"
                  min={1}
                  max={50000}
                  placeholder="Guests"
                  value={quickAdd.guest_estimate ?? ""}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, guest_estimate: e.target.value ? parseInt(e.target.value, 10) : null }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveQuickAdd();
                    if (e.key === "Escape") cancelQuickAdd();
                  }}
                  disabled={quickAddSaving}
                  className="h-7 text-sm"
                />
              </TableCell>
              {/* Product */}
              <TableCell className="hidden md:table-cell">
                <Select
                  value={quickAdd.product?.toString() || ""}
                  onValueChange={(v) => setQuickAdd((p) => ({ ...p, product: parseInt(v, 10) }))}
                >
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue placeholder="Product" />
                  </SelectTrigger>
                  <SelectContent>
                    {productLines.map((pl) => (
                      <SelectItem key={pl.id} value={pl.id.toString()}>{pl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              {/* Assigned To */}
              <TableCell className="hidden lg:table-cell">
                <Select
                  value={quickAdd.assigned_to?.toString() || ""}
                  onValueChange={(v) => setQuickAdd((p) => ({ ...p, assigned_to: parseInt(v, 10) }))}
                >
                  <SelectTrigger className="h-7 text-sm">
                    <SelectValue placeholder="Assign" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id.toString()}>
                        {u.first_name} {u.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              {/* Notes */}
              <TableCell className="hidden xl:table-cell align-top">
                <Textarea
                  rows={1}
                  placeholder="Notes"
                  value={quickAdd.notes || ""}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, notes: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveQuickAdd();
                    if (e.key === "Escape") cancelQuickAdd();
                  }}
                  disabled={quickAddSaving}
                  className="text-sm min-h-0"
                />
              </TableCell>
              {/* Source */}
              <TableCell className="hidden md:table-cell text-muted-foreground text-xs">—</TableCell>
              {/* Status */}
              <TableCell className="text-muted-foreground text-xs">—</TableCell>
              {/* Created */}
              <TableCell className="hidden xl:table-cell text-muted-foreground text-xs">—</TableCell>
            </TableRow>
          )}

          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={13} className="text-center text-muted-foreground py-12">
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

                {/* Name - links to lead detail */}
                <TableCell className="font-medium">
                  <div className="flex items-center gap-1.5">
                    <Link href={`/leads/${lead.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      {lead.contact_name}
                    </Link>
                    {lead.has_unread_whatsapp && (
                      <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500" title="Unread WhatsApp message" />
                    )}
                  </div>
                </TableCell>

                {/* Email - editable text */}
                <EditableTextCell
                  lead={lead}
                  field="contact_email"
                  display={lead.contact_email || "-"}
                  className="hidden lg:table-cell text-muted-foreground"
                  type="email"
                />

                {/* Event Type - editable select */}
                <EditableSelectCell
                  lead={lead}
                  field="event_type"
                  display={lead.event_type_display}
                  className="hidden md:table-cell"
                  options={eventTypes}
                />

                {/* Event Date - editable date */}
                <EditableTextCell
                  lead={lead}
                  field="event_date"
                  display={lead.event_date ? formatDate(lead.event_date, dateFormat) : "-"}
                  type="date"
                />

                {/* Lead Date - non-editable, navigates */}
                <TableCell
                  className="hidden lg:table-cell"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.lead_date ? formatDate(lead.lead_date, dateFormat) : "-"}
                </TableCell>

                {/* Guests - editable number */}
                <EditableTextCell
                  lead={lead}
                  field="guest_estimate"
                  display={lead.guest_estimate != null ? String(lead.guest_estimate) : "-"}
                  type="number"
                />

                {/* Product - editable select */}
                <EditableSelectCell
                  lead={lead}
                  field="product"
                  display={
                    lead.product_name ? (
                      <span className="text-xs font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        {lead.product_name}
                      </span>
                    ) : "-"
                  }
                  className="hidden md:table-cell"
                  options={productLines.map((p) => ({ value: p.id.toString(), label: p.name }))}
                  allowClear
                />

                {/* Assigned To - editable select */}
                <EditableSelectCell
                  lead={lead}
                  field="assigned_to"
                  display={lead.assigned_to_name || "-"}
                  className="hidden lg:table-cell"
                  options={users.map((u) => ({
                    value: u.id.toString(),
                    label: `${u.first_name} ${u.last_name}`,
                  }))}
                  allowClear
                />

                {/* Notes - editable textarea */}
                {isSaving("notes", lead.id) ? (
                  <TableCell className="hidden xl:table-cell text-muted-foreground text-xs min-w-[200px]">
                    <span className="text-xs text-muted-foreground italic">Saving...</span>
                  </TableCell>
                ) : isEditing("notes", lead.id) ? (
                  <TableCell className="hidden xl:table-cell min-w-[200px]" onClick={(e) => e.stopPropagation()}>
                    <Textarea
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit(lead.id, "notes", draft);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={() => commitEdit(lead.id, "notes", draft)}
                      autoFocus
                      className="text-sm w-full min-w-0 min-h-0"
                    />
                  </TableCell>
                ) : (
                  <TableCell
                    className="hidden xl:table-cell text-muted-foreground text-xs min-w-[200px] cursor-pointer hover:underline decoration-dotted underline-offset-4"
                    title={lead.notes || undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(lead.id, "notes", lead.notes || "");
                    }}
                  >
                    {lead.notes
                      ? lead.notes.length > 30
                        ? lead.notes.slice(0, 30) + "…"
                        : lead.notes
                      : "-"}
                  </TableCell>
                )}

                {/* Source - non-editable, navigates */}
                <TableCell
                  className="hidden md:table-cell capitalize"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {lead.source}
                </TableCell>

                {/* Status - editable select */}
                <EditableSelectCell
                  lead={lead}
                  field="status"
                  display={
                    <Badge variant={STATUS_VARIANT[lead.status] || "secondary"}>
                      {lead.status_display}
                    </Badge>
                  }
                  options={leadStatuses.map((s) => ({ value: s.value, label: s.label }))}
                />

                {/* Created - non-editable, navigates */}
                <TableCell
                  className="hidden xl:table-cell text-muted-foreground text-xs"
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  {formatDate(lead.created_at, dateFormat)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
