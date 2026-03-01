"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { api, Lead } from "@/lib/api";

const COLUMNS = [
  { status: "new", label: "New", color: "bg-blue-500", badge: "bg-blue-100 text-blue-700" },
  { status: "contacted", label: "Contacted", color: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-700" },
  { status: "qualified", label: "Qualified", color: "bg-purple-500", badge: "bg-purple-100 text-purple-700" },
  { status: "converted", label: "Converted", color: "bg-green-500", badge: "bg-green-100 text-green-700" },
  { status: "lost", label: "Lost", color: "bg-gray-400", badge: "bg-gray-100 text-gray-500" },
] as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["qualified", "lost"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: ["new"],
};

function LeadCard({ lead, isDragging }: { lead: Lead; isDragging?: boolean }) {
  const router = useRouter();

  return (
    <div
      onClick={() => !isDragging && router.push(`/leads/${lead.id}`)}
      className={`bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:border-blue-300 transition-colors ${
        isDragging ? "shadow-lg ring-2 ring-blue-400 opacity-90" : ""
      }`}
    >
      <p className="font-medium text-sm text-gray-900 truncate">{lead.contact_name}</p>
      <p className="text-xs text-gray-500 mt-1">
        {lead.event_type_display}
        {lead.event_date && ` · ${lead.event_date}`}
      </p>
      {lead.guest_estimate && (
        <p className="text-xs text-gray-400 mt-0.5">{lead.guest_estimate} guests</p>
      )}
    </div>
  );
}

function DraggableCard({ lead }: { lead: Lead }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id.toString(), data: { lead } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
      <div className={`${color} rounded-t-lg px-3 py-2 flex items-center justify-between`}>
        <span className="text-white text-sm font-semibold">{label}</span>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${badge}`}>
          {leads.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 bg-gray-50 rounded-b-lg p-2 space-y-2 min-h-[200px] transition-colors ${
          isOver ? "bg-blue-50 ring-2 ring-blue-300 ring-inset" : ""
        }`}
      >
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">No leads</p>
        )}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const loadLeads = useCallback(() => {
    setLoading(true);
    api.getLeads()
      .then(setLeads)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = search
    ? leads.filter((l) =>
        l.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        l.event_type_display.toLowerCase().includes(search.toLowerCase()) ||
        l.account_name?.toLowerCase().includes(search.toLowerCase())
      )
    : leads;

  const leadsByStatus = COLUMNS.reduce<Record<string, Lead[]>>((acc, col) => {
    acc[col.status] = filtered.filter((l) => l.status === col.status);
    return acc;
  }, {});

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
    if (targetStatus === lead.status) return;

    const allowed = ALLOWED_TRANSITIONS[lead.status] || [];
    if (!allowed.includes(targetStatus)) {
      const targetLabel = COLUMNS.find((c) => c.status === targetStatus)?.label || targetStatus;
      setToast(`Cannot move from ${lead.status_display} to ${targetLabel}`);
      return;
    }

    // Optimistic update
    setLeads((prev) =>
      prev.map((l) =>
        l.id === lead.id ? { ...l, status: targetStatus } : l
      )
    );

    try {
      await api.transitionLead(lead.id, targetStatus);
      // Reload to get fresh data (status_display, timestamps, etc.)
      loadLeads();
    } catch (e: unknown) {
      // Revert on failure
      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, status: lead.status } : l
        )
      );
      const msg = e instanceof Error ? e.message : "Transition failed";
      setToast(msg);
    }
  }

  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h1 className="text-2xl font-bold text-gray-900 shrink-0">Leads</h1>
        <div className="flex items-center gap-3 flex-1 justify-end">
          <input
            type="text"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <Link
            href="/leads/new"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 whitespace-nowrap"
          >
            New Lead
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading leads...</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
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
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
