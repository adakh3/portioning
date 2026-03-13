"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Lead, Account, AuthUser, ProductLine, Reminder, WhatsAppMessage } from "@/lib/api";
import { useAccounts, useLead, useSiteSettings, useDateFormat, useProductLines, useUsers, useSources, useEventTypes, useServiceStyles, useLeadStatuses, useLostReasons, useLeadReminders, useLeadWhatsAppMessages, revalidate } from "@/lib/hooks";
import { formatDate, formatDateTime } from "@/lib/dateFormat";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ValidatedInput } from "@/components/ui/validated-input";
import { Textarea } from "@/components/ui/textarea";
import ActivityTimeline from "@/components/ActivityTimeline";


const STATUS_BADGE_VARIANT: Record<string, "info" | "warning" | "default" | "success" | "secondary"> = {
  new: "info",
  contacted: "warning",
  qualified: "default",
  proposal_sent: "info",
  won: "success",
  lost: "secondary",
};

const TRANSITION_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "secondary" | "destructive" }> = {
  contacted: { label: "Mark Contacted", variant: "warning" },
  qualified: { label: "Mark Qualified", variant: "default" },
  proposal_sent: { label: "Mark Proposal Sent", variant: "default" },
  won: { label: "Mark Won", variant: "success" },
  lost: { label: "Mark Lost", variant: "secondary" },
  new: { label: "Reopen", variant: "default" },
};

const QUOTE_BADGE_VARIANT: Record<string, "success" | "info" | "secondary" | "destructive" | "warning"> = {
  accepted: "success",
  sent: "info",
  draft: "secondary",
  declined: "destructive",
};

type FieldStatus = "idle" | "saving" | "saved" | "error";

function formatWholeNumber(val: string): string {
  const num = parseInt(val, 10);
  if (isNaN(num)) return val;
  return num.toLocaleString();
}

function AutoSaveField({
  field,
  label,
  type,
  value,
  options,
  required,
  leadId,
  mutateLead,
  transform,
  formatDisplay,
  inputMode,
  placeholder,
  status,
  setStatus,
}: {
  field: string;
  label: string;
  type: "text" | "email" | "tel" | "number" | "date" | "select" | "textarea";
  value: string | number;
  options?: { value: string | number; label: string }[];
  required?: boolean;
  leadId: number;
  mutateLead: (data?: Lead | Promise<Lead>, revalidate?: boolean) => void;
  transform?: (val: string) => unknown;
  formatDisplay?: (val: string) => string;
  inputMode?: "numeric" | "text";
  placeholder?: string;
  status: FieldStatus;
  setStatus: (s: FieldStatus) => void;
}) {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
  const [focused, setFocused] = useState(false);
  const lastSaved = useRef(String(value ?? ""));

  useEffect(() => {
    const sv = String(value ?? "");
    setLocalValue(sv);
    lastSaved.current = sv;
  }, [value]);

  const save = useCallback(async (val: string) => {
    if (val === lastSaved.current) return;
    setStatus("saving");
    const payload = transform ? transform(val) : val;
    try {
      const updated = await api.updateLead(leadId, { [field]: payload });
      mutateLead(updated, false);
      lastSaved.current = val;
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      setLocalValue(lastSaved.current);
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [field, leadId, mutateLead, transform, setStatus]);

  const handleBlur = () => {
    setFocused(false);
    save(localValue);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && type !== "textarea") {
      e.preventDefault();
      save(localValue);
    }
  };

  const indicator = status === "saving" ? (
    <span className="text-xs text-muted-foreground ml-1">saving...</span>
  ) : status === "saved" ? (
    <span className="text-xs text-green-600 ml-1">&#10003;</span>
  ) : status === "error" ? (
    <span className="text-xs text-destructive ml-1">failed</span>
  ) : null;

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  const displayValue = !focused && formatDisplay ? formatDisplay(localValue) : localValue;

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-1">
        {label}{required && " *"}{indicator}
      </label>
      {type === "select" ? (
        <select
          value={localValue}
          onChange={(e) => {
            setLocalValue(e.target.value);
            save(e.target.value);
          }}
          className={selectClass}
        >
          {options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <Textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          rows={3}
        />
      ) : (
        <ValidatedInput
          type={formatDisplay ? "text" : type}
          inputMode={inputMode}
          value={displayValue}
          onChange={(e) => {
            const raw = formatDisplay ? e.target.value.replace(/[^0-9]/g, "") : e.target.value;
            setLocalValue(raw);
          }}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          required={required}
          placeholder={placeholder}
          min={type === "number" ? 1 : undefined}
        />
      )}
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const isNew = id === "new";
  const { data: lead, error: loadError, isLoading: leadLoading, mutate: mutateLead } = useLead(isNew ? null : (Number(id) || null));
  const loading = isNew ? false : leadLoading;
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "\u00a3", currency_code: "GBP", date_format: "DD/MM/YYYY", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };
  const dateFormat = useDateFormat();
  const { data: productLines = [] } = useProductLines();
  const { data: users = [] } = useUsers();
  const { data: sources = [] } = useSources();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const { data: leadStatuses = [] } = useLeadStatuses();
  const { data: lostReasons = [] } = useLostReasons();
  const { data: accountsList = [] } = useAccounts();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [lostReasonId, setLostReasonId] = useState<number | null>(null);
  const [lostNotesInput, setLostNotesInput] = useState("");
  const [showWonDialog, setShowWonDialog] = useState(false);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});

  // Create mode form state
  const [formData, setFormData] = useState({
    account: "" as string | number,
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    source: "website",
    event_date: "",
    guest_estimate: "",
    budget: "",
    event_type: "other",
    service_style: "",
    product: "" as string | number,
    assigned_to: "" as string | number,
    notes: "",
  });
  const setField = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormData({ ...formData, [field]: e.target.value });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data = {
        ...formData,
        account: formData.account ? Number(formData.account) : null,
        guest_estimate: formData.guest_estimate ? Number(formData.guest_estimate) : null,
        event_date: formData.event_date || null,
        budget: formData.budget || null,
        product: formData.product ? Number(formData.product) : null,
        assigned_to: formData.assigned_to ? Number(formData.assigned_to) : null,
      };
      const newLead = await api.createLead(data);
      revalidate("leads");
      router.push(`/leads/${newLead.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create lead");
      setSaving(false);
    }
  }

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {});
  }, []);

  const setStatus = useCallback((field: string) => (s: FieldStatus) => {
    setFieldStatus((prev) => ({ ...prev, [field]: s }));
  }, []);

  const fkTransform = (val: string) => val ? Number(val) : null;
  const nullableString = (val: string) => val || null;

  async function handleTransition(newStatus: string) {
    if (!lead) return;
    if (newStatus === "lost") {
      setShowLostDialog(true);
      return;
    }
    if (newStatus === "won") {
      setShowWonDialog(true);
      return;
    }
    setTransitioning(true);
    setError("");
    try {
      const updated = await api.transitionLead(lead.id, newStatus);
      mutateLead(updated, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transition");
    } finally {
      setTransitioning(false);
    }
  }

  async function handleCreateQuote() {
    if (!lead) return;
    setCreatingQuote(true);
    setError("");
    try {
      const quote = await api.createQuoteFromLead(lead.id);
      router.push(`/quotes/${quote.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quote");
      setCreatingQuote(false);
    }
  }

  async function handleMarkWon(createEvent: boolean, quoteId?: number) {
    if (!lead) return;
    setTransitioning(true);
    setError("");
    try {
      const updated = await api.markLeadWon(lead.id, { create_event: createEvent, quote_id: quoteId });
      mutateLead(updated, false);
      setShowWonDialog(false);
      if (createEvent && updated.won_event) {
        router.push(`/events/${updated.won_event}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark won");
    } finally {
      setTransitioning(false);
    }
  }

  async function handleCreateEventFromLead() {
    if (!lead) return;
    setTransitioning(true);
    setError("");
    try {
      const event = await api.createEventFromLead(lead.id);
      router.push(`/events/${event.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
      setTransitioning(false);
    }
  }

  async function handleConfirmLost() {
    if (!lead || !lostReasonId) return;
    setTransitioning(true);
    setError("");
    try {
      const updated = await api.transitionLead(lead.id, "lost", {
        lost_reason_option: lostReasonId,
        lost_notes: lostNotesInput,
      });
      mutateLead(updated, false);
      setShowLostDialog(false);
      setLostReasonId(null);
      setLostNotesInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark lost");
    } finally {
      setTransitioning(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!isNew && loadError && !lead) return <p className="text-destructive">Error: {loadError.message}</p>;
  if (!isNew && !lead) return <p className="text-muted-foreground">Lead not found.</p>;

  // Create mode — render a form
  if (isNew) {
    const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/leads" className="text-primary hover:underline">&larr; Leads</Link>
        </div>

        {error && <p className="text-destructive">{error}</p>}

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <h1 className="text-2xl font-bold text-foreground">New Lead</h1>
            </div>
            <form onSubmit={handleCreate}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Contact Name *</label>
                  <ValidatedInput type="text" required maxLength={60} value={formData.contact_name} onChange={setField("contact_name")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Account (optional)</label>
                  <select value={formData.account} onChange={setField("account")} className={selectClass}>
                    <option value="">-- No account --</option>
                    {accountsList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Email</label>
                  <ValidatedInput type="email" maxLength={100} value={formData.contact_email} onChange={setField("contact_email")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Phone</label>
                  <ValidatedInput type="tel" maxLength={20} value={formData.contact_phone} onChange={setField("contact_phone")} />
                </div>
              </div>

              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
                  <select value={formData.event_type} onChange={setField("event_type")} className={selectClass}>
                    {eventTypes.map((et) => <option key={et.id} value={et.value}>{et.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Event Date</label>
                  <ValidatedInput type="date" value={formData.event_date} onChange={setField("event_date")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Guest Estimate</label>
                  <ValidatedInput type="number" min={1} max={50000} value={formData.guest_estimate} onChange={setField("guest_estimate")} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Budget</label>
                  <ValidatedInput
                    type="text"
                    inputMode="numeric"
                    value={formData.budget ? parseInt(formData.budget, 10).toLocaleString() : ""}
                    maxLength={15}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
                      setFormData({ ...formData, budget: raw });
                    }}
                    placeholder="e.g. 5,000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Service Style</label>
                  <select value={formData.service_style} onChange={setField("service_style")} className={selectClass}>
                    <option value="">-- Select --</option>
                    {serviceStyles.map((ss) => <option key={ss.id} value={ss.value}>{ss.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Source</label>
                  <select value={formData.source} onChange={setField("source")} className={selectClass}>
                    {sources.map((s) => <option key={s.id} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Assignment</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Product / Service</label>
                  <select value={formData.product} onChange={setField("product")} className={selectClass}>
                    <option value="">-- Select --</option>
                    {productLines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Assigned To</label>
                  <select value={formData.assigned_to} onChange={setField("assigned_to")} className={selectClass}>
                    <option value="">-- Unassigned --</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                  </select>
                </div>
              </div>

              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notes</h2>
              <div className="mb-6">
                <Textarea maxLength={2000} value={formData.notes} onChange={setField("notes")} rows={3} />
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? "Creating..." : "Create Lead"}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push("/leads")}>
                  Discard
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // At this point, lead is guaranteed to be defined (isNew early-returns above, and !lead guard returns)
  const l = lead!;

  // Contextual next steps based on current status
  const NEXT_STEPS: Record<string, string[]> = {
    new: ["contacted", "lost"],
    contacted: ["qualified", "lost"],
    qualified: ["proposal_sent", "won", "lost"],
    proposal_sent: ["won", "lost"],
    won: ["new"],
    lost: ["new"],
  };
  const PRIMARY_NEXT: Record<string, string | null> = {
    new: "contacted",
    contacted: "qualified",
    qualified: "proposal_sent",
    proposal_sent: "won",
    won: null,
    lost: "new",
  };
  const nextSteps = NEXT_STEPS[l.status] || [];
  const primaryStep = PRIMARY_NEXT[l.status] ?? null;
  const overflowSteps = nextSteps.filter(s => s !== primaryStep);
  // For won leads without event, "Create Event" is the primary action
  const wonNeedsEvent = l.status === "won" && !l.won_event;
  const showCreateQuoteButton = !["won", "lost"].includes(l.status);
  const hasOverflowItems = overflowSteps.length > 0;
  const cs = settings.currency_symbol;

  const fieldProps = (field: string) => ({
    field,
    leadId: l.id,
    mutateLead,
    status: fieldStatus[field] || "idle" as FieldStatus,
    setStatus: setStatus(field),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/leads" className="text-primary hover:underline">&larr; Leads</Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">{l.contact_name}</h1>
                <Badge variant={STATUS_BADGE_VARIANT[l.status] || "secondary"}>
                  {l.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {l.event_type_display}
                {l.event_date && ` \u00b7 ${l.event_date}`}
                {l.guest_estimate && ` \u00b7 ${l.guest_estimate} guests`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Create Quote button */}
              {showCreateQuoteButton && (
                <Button size="sm" variant="outline" onClick={handleCreateQuote} disabled={creatingQuote}>
                  {creatingQuote ? "Creating..." : "Create Quote"}
                </Button>
              )}

              {/* Primary action button */}
              {wonNeedsEvent ? (
                <Button size="sm" variant="success" onClick={handleCreateEventFromLead} disabled={transitioning}>
                  {transitioning ? "..." : "Create Event"}
                </Button>
              ) : primaryStep ? (
                <Button
                  size="sm"
                  onClick={() => handleTransition(primaryStep)}
                  disabled={transitioning}
                  variant={TRANSITION_LABELS[primaryStep]?.variant || "default"}
                >
                  {transitioning ? "..." : TRANSITION_LABELS[primaryStep]?.label || primaryStep}
                </Button>
              ) : null}

              {/* Overflow menu */}
              {hasOverflowItems && (
                <div className="relative">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowOverflow(!showOverflow)}
                    className="px-2"
                  >
                    &#8943;
                  </Button>
                  {showOverflow && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[160px]">
                        {overflowSteps.map((status) => {
                          const { label } = TRANSITION_LABELS[status] || { label: status };
                          return (
                            <button
                              key={status}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50"
                              disabled={transitioning}
                              onClick={() => {
                                setShowOverflow(false);
                                handleTransition(status);
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </CardContent>
      </Card>

      {/* Contact */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AutoSaveField {...fieldProps("contact_name")} label="Name" type="text" value={l.contact_name} required />
            <AutoSaveField {...fieldProps("contact_email")} label="Email" type="email" value={l.contact_email} />
            <AutoSaveField {...fieldProps("contact_phone")} label="Phone" type="tel" value={l.contact_phone} />
            <AutoSaveField
              {...fieldProps("account")}
              label="Account"
              type="select"
              value={l.account ?? ""}
              transform={fkTransform}
              options={[{ value: "", label: "-- No account --" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Event Details */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AutoSaveField
                {...fieldProps("event_type")}
                label="Event Type"
                type="select"
                value={l.event_type}
                options={eventTypes.map((et) => ({ value: et.value, label: et.label }))}
              />
              <AutoSaveField {...fieldProps("event_date")} label="Event Date" type="date" value={l.event_date || ""} transform={nullableString} />
              <AutoSaveField {...fieldProps("guest_estimate")} label="Guest Estimate" type="number" value={l.guest_estimate ?? ""} transform={fkTransform} />
              <AutoSaveField {...fieldProps("budget")} label="Budget" type="text" inputMode="numeric" value={l.budget ? String(Math.round(Number(l.budget))) : ""} transform={nullableString} formatDisplay={formatWholeNumber} placeholder="e.g. 5,000" />
              <AutoSaveField
                {...fieldProps("service_style")}
                label="Service Style"
                type="select"
                value={l.service_style || ""}
                options={[{ value: "", label: "-- Select --" }, ...serviceStyles.map((ss) => ({ value: ss.value, label: ss.label }))]}
              />
            </div>
        </CardContent>
      </Card>

      {/* Assignment */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Assignment</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AutoSaveField
                {...fieldProps("product")}
                label="Product / Service"
                type="select"
                value={l.product ?? ""}
                transform={fkTransform}
                options={[{ value: "", label: "-- Select --" }, ...productLines.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <AutoSaveField
                {...fieldProps("assigned_to")}
                label="Assigned To"
                type="select"
                value={l.assigned_to ?? ""}
                transform={fkTransform}
                options={[{ value: "", label: "-- Unassigned --" }, ...users.map((u) => ({ value: u.id, label: `${u.first_name} ${u.last_name}` }))]}
              />
              <AutoSaveField
                {...fieldProps("source")}
                label="Source"
                type="select"
                value={l.source}
                options={sources.map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notes</h2>
          <AutoSaveField {...fieldProps("notes")} label="Notes" type="textarea" value={l.notes} />
          {l.status === "lost" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {l.lost_reason_option_display && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Lost Reason</label>
                  <p className="text-sm text-muted-foreground py-2">{l.lost_reason_option_display}</p>
                </div>
              )}
              <div className="md:col-span-2">
                <AutoSaveField {...fieldProps("lost_notes")} label="Lost Notes" type="textarea" value={l.lost_notes || ""} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Timeline</h2>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>Created: {formatDateTime(l.created_at, dateFormat)}</div>
            {l.contacted_at && <div>Contacted: {formatDateTime(l.contacted_at, dateFormat)}</div>}
            {l.qualified_at && <div>Qualified: {formatDateTime(l.qualified_at, dateFormat)}</div>}
            {l.proposal_sent_at && <div>Proposal Sent: {formatDateTime(l.proposal_sent_at, dateFormat)}</div>}
            {l.won_at && <div>Won: {formatDateTime(l.won_at, dateFormat)}</div>}
            {l.lost_at && <div>Lost: {formatDateTime(l.lost_at, dateFormat)}</div>}
          </div>
        </CardContent>
      </Card>

      {/* Linked Quotes */}
      {l.quotes && l.quotes.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quotes</h2>
            <div className="space-y-3">
              {l.quotes.map((q) => (
                <Link
                  key={q.id}
                  href={`/quotes/${q.id}`}
                  className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">Quote #{q.id}</span>
                    <Badge variant={QUOTE_BADGE_VARIANT[q.status] || "warning"}>
                      {q.status_display}
                    </Badge>
                  </div>
                  <span className="font-semibold text-foreground">{formatCurrency(q.total, cs)}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked Event */}
      {l.won_event && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event</h2>
            <Link
              href={`/events/${l.won_event}`}
              className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-foreground">{l.won_event_name || `Event #${l.won_event}`}</span>
                <Badge variant="success">Created</Badge>
              </div>
              <span className="text-sm text-primary">View Event &rarr;</span>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Reminders */}
      <LeadReminders leadId={l.id} />

      {/* WhatsApp Messages */}
      <LeadWhatsApp leadId={l.id} contactPhone={l.contact_phone} contactName={l.contact_name} eventType={l.event_type} eventDate={l.event_date} />

      {/* Activity Log */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Activity</h2>
          <ActivityTimeline leadId={l.id} />
        </CardContent>
      </Card>

      {/* Mark Won Dialog */}
      {showWonDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4 border-2 border-success/30">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">&#127881;</div>
              <h3 className="text-xl font-semibold text-foreground">Congratulations!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                You&apos;re about to close this deal. What&apos;s next?
              </p>
            </div>
            {l.quotes && l.quotes.filter(q => q.status === "accepted").length > 0 && (
              <p className="text-xs text-muted-foreground text-center mb-4 bg-muted rounded-md px-3 py-2">
                The event will use data from the accepted quote.
              </p>
            )}
            <div className="space-y-3">
              <button
                disabled={transitioning}
                onClick={() => {
                  const acceptedQuote = l.quotes?.find(q => q.status === "accepted");
                  handleMarkWon(true, acceptedQuote?.id);
                }}
                className="w-full text-left p-4 rounded-lg border-2 border-success/30 bg-success/5 hover:bg-success/10 hover:border-success/50 transition-colors disabled:opacity-50"
              >
                <div className="font-semibold text-foreground">Create Event Now</div>
                <div className="text-sm text-muted-foreground mt-0.5">Set up the event straight away</div>
              </button>
              <button
                disabled={transitioning}
                onClick={() => handleMarkWon(false)}
                className="w-full text-left p-4 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                <div className="font-semibold text-foreground">Mark as Won</div>
                <div className="text-sm text-muted-foreground mt-0.5">I&apos;ll create the event later</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <Button variant="secondary" onClick={() => setShowWonDialog(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Lost Dialog */}
      {showLostDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-foreground mb-4">Mark Lead as Lost</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Reason *</label>
                <select
                  value={lostReasonId ?? ""}
                  onChange={(e) => setLostReasonId(e.target.value ? Number(e.target.value) : null)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">-- Select reason --</option>
                  {lostReasons.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Notes (optional)</label>
                <Textarea
                  value={lostNotesInput}
                  onChange={(e) => setLostNotesInput(e.target.value)}
                  rows={3}
                  placeholder="Additional details..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => { setShowLostDialog(false); setLostReasonId(null); setLostNotesInput(""); }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!lostReasonId || transitioning}
                onClick={handleConfirmLost}
              >
                {transitioning ? "Saving..." : "Mark Lost"}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const QUICK_PICKS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In 5 days", days: 5 },
  { label: "In 1 week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0); // default to 9 AM
  return d.toISOString();
}

function LeadReminders({ leadId }: { leadId: number }) {
  const dateFormat = useDateFormat();
  const { data: reminders = [], mutate } = useLeadReminders(leadId);
  const [showForm, setShowForm] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedDays, setSelectedDays] = useState(3);

  const pendingReminders = reminders.filter((r) => r.status === "pending");

  async function handleCreate() {
    setSubmitting(true);
    try {
      await api.createReminder(leadId, { due_at: addDays(selectedDays), note });
      setNote("");
      setSelectedDays(3);
      setShowForm(false);
      mutate();
      revalidate("reminder-counts");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(id: number, status: string) {
    await api.updateReminder(id, { status });
    mutate();
    revalidate("reminder-counts");
  }

  const now = new Date();

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Reminders</h2>
            {pendingReminders.length > 0 && (
              <Badge variant="warning">{pendingReminders.length}</Badge>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Add Reminder"}
          </Button>
        </div>

        {showForm && (
          <div className="border border-border rounded-lg p-3 mb-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">Follow up</label>
              <div className="flex flex-wrap gap-2">
                {QUICK_PICKS.map((pick) => (
                  <button
                    key={pick.days}
                    type="button"
                    onClick={() => setSelectedDays(pick.days)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                      selectedDays === pick.days
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    }`}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {formatDate(addDays(selectedDays), dateFormat)} at 9:00 AM
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Note (optional)</label>
              <ValidatedInput
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Follow up on pricing"
              />
            </div>
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Reminder"}
            </Button>
          </div>
        )}

        {reminders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders set for this lead.</p>
        ) : (
          <div className="space-y-2">
            {reminders.map((r) => {
              const isOverdue = r.status === "pending" && new Date(r.due_at) < now;
              return (
                <div
                  key={r.id}
                  className={`flex items-start gap-3 p-3 border rounded-lg ${
                    r.status !== "pending"
                      ? "border-border/50 opacity-60"
                      : isOverdue
                        ? "border-red-300 bg-red-50 dark:bg-red-950/20"
                        : "border-border"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {r.note && (
                        <span className="text-sm text-foreground">{r.note}</span>
                      )}
                      {r.status !== "pending" && (
                        <Badge variant="secondary">{r.status}</Badge>
                      )}
                      {isOverdue && <Badge variant="destructive">Overdue</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Due: {formatDateTime(r.due_at, dateFormat)}
                      {r.completed_at && ` | Completed: ${formatDateTime(r.completed_at, dateFormat)}`}
                    </p>
                  </div>
                  {r.status === "pending" && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleAction(r.id, "done")}
                      >
                        Done
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAction(r.id, "dismissed")}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const WHATSAPP_TEMPLATES = [
  { value: "reminder", label: "Event Reminder" },
  { value: "follow_up", label: "Follow Up" },
];

function LeadWhatsApp({ leadId, contactPhone, contactName, eventType, eventDate }: {
  leadId: number;
  contactPhone: string;
  contactName: string;
  eventType: string;
  eventDate: string | null;
}) {
  const dateFormat = useDateFormat();
  const { data: messages = [], mutate } = useLeadWhatsAppMessages(leadId);
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleTemplateChange = (template: string) => {
    setSelectedTemplate(template);
    if (!template) { setBody(""); return; }
    // Preview template text client-side
    const previews: Record<string, string> = {
      reminder: `Hi ${contactName}, this is a friendly reminder about your upcoming ${eventType} on ${eventDate || "TBD"}. Please let us know if you have any questions!`,
      follow_up: `Hi ${contactName}, thank you for your interest in our catering services. We wanted to follow up on your enquiry for ${eventType}. Would you like to discuss your requirements?`,
    };
    setBody(previews[template] || "");
  };

  const handleSend = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError("");
    try {
      if (selectedTemplate) {
        await api.sendWhatsAppMessage(leadId, {
          template: selectedTemplate,
          template_context: { contact_name: contactName, event_type: eventType, event_date: eventDate || "TBD" },
        });
      } else {
        await api.sendWhatsAppMessage(leadId, { body });
      }
      setBody("");
      setSelectedTemplate("");
      setShowForm(false);
      mutate();
      revalidate(`lead-activity-${leadId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  if (!contactPhone) return null;

  const statusColor: Record<string, string> = {
    sent: "text-blue-600",
    delivered: "text-green-600",
    read: "text-green-700",
    failed: "text-red-600",
    undelivered: "text-red-500",
    queued: "text-muted-foreground",
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">WhatsApp Messages</h2>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "Send Message"}
          </Button>
        </div>

        {showForm && (
          <div className="space-y-3 mb-4 p-3 border rounded-lg bg-muted/30">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Template (optional)</label>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Custom message</option>
                {WHATSAPP_TEMPLATES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Message</label>
              <Textarea
                value={body}
                onChange={(e) => { setBody(e.target.value); setSelectedTemplate(""); }}
                rows={3}
                placeholder="Type your message..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSend} disabled={sending || !body.trim()}>
                {sending ? "Sending..." : "Send WhatsApp"}
              </Button>
              <span className="text-xs text-muted-foreground">To: {contactPhone}</span>
            </div>
          </div>
        )}

        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No WhatsApp messages yet.</p>
        ) : (
          <div className="space-y-2">
            {messages.map((m) => (
              <div key={m.id} className="p-3 border rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{m.body}</p>
                  <span className={`text-xs font-medium shrink-0 ${statusColor[m.status] || "text-muted-foreground"}`}>
                    {m.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(m.created_at, dateFormat)}
                  </span>
                  {m.sent_by_name && (
                    <span className="text-xs text-muted-foreground">by {m.sent_by_name}</span>
                  )}
                  {m.error_message && (
                    <span className="text-xs text-destructive">{m.error_message}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
