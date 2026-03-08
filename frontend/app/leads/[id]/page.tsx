"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Lead, Account, AuthUser, ProductLine, Reminder } from "@/lib/api";
import { useLead, useSiteSettings, useProductLines, useUsers, useSources, useEventTypes, useServiceStyles, useLeadStatuses, useLostReasons, useLeadReminders, revalidate } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        <Input
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
  const { data: lead, error: loadError, isLoading: loading, mutate: mutateLead } = useLead(Number(id) || null);
  const { data: rawSettings } = useSiteSettings();
  const settings = rawSettings || { currency_symbol: "\u00a3", currency_code: "GBP", default_price_per_head: "0.00", target_food_cost_percentage: "30.00", price_rounding_step: "50" };
  const { data: productLines = [] } = useProductLines();
  const { data: users = [] } = useUsers();
  const { data: sources = [] } = useSources();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const { data: leadStatuses = [] } = useLeadStatuses();
  const { data: lostReasons = [] } = useLostReasons();
  const [error, setError] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const [showLostDialog, setShowLostDialog] = useState(false);
  const [lostReasonId, setLostReasonId] = useState<number | null>(null);
  const [lostNotesInput, setLostNotesInput] = useState("");
  const [showWonDialog, setShowWonDialog] = useState(false);
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fieldStatus, setFieldStatus] = useState<Record<string, FieldStatus>>({});

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
  if (loadError && !lead) return <p className="text-destructive">Error: {loadError.message}</p>;
  if (!lead) return <p className="text-muted-foreground">Lead not found.</p>;

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
  const nextSteps = NEXT_STEPS[lead.status] || [];
  const primaryStep = PRIMARY_NEXT[lead.status] ?? null;
  const overflowSteps = nextSteps.filter(s => s !== primaryStep);
  // For won leads without event, "Create Event" is the primary action
  const wonNeedsEvent = lead.status === "won" && !lead.won_event;
  // Include "Create Quote" in overflow for active pipeline stages
  const showCreateQuoteInOverflow = !["won", "lost"].includes(lead.status);
  const hasOverflowItems = overflowSteps.length > 0 || showCreateQuoteInOverflow;
  const cs = settings.currency_symbol;

  const fieldProps = (field: string) => ({
    field,
    leadId: lead.id,
    mutateLead,
    status: fieldStatus[field] || "idle" as FieldStatus,
    setStatus: setStatus(field),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/leads" className="text-primary hover:underline">&larr; Back to Leads</Link>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-foreground">{lead.contact_name}</h1>
                <Badge variant={STATUS_BADGE_VARIANT[lead.status] || "secondary"}>
                  {lead.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {lead.event_type_display}
                {lead.event_date && ` \u00b7 ${lead.event_date}`}
                {lead.guest_estimate && ` \u00b7 ${lead.guest_estimate} guests`}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
                        {showCreateQuoteInOverflow && (
                          <button
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50"
                            disabled={creatingQuote || transitioning}
                            onClick={() => {
                              setShowOverflow(false);
                              handleCreateQuote();
                            }}
                          >
                            Create Quote
                          </button>
                        )}
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
            <AutoSaveField {...fieldProps("contact_name")} label="Name" type="text" value={lead.contact_name} required />
            <AutoSaveField {...fieldProps("contact_email")} label="Email" type="email" value={lead.contact_email} />
            <AutoSaveField {...fieldProps("contact_phone")} label="Phone" type="tel" value={lead.contact_phone} />
            <AutoSaveField
              {...fieldProps("account")}
              label="Account"
              type="select"
              value={lead.account ?? ""}
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
                value={lead.event_type}
                options={eventTypes.map((et) => ({ value: et.value, label: et.label }))}
              />
              <AutoSaveField {...fieldProps("event_date")} label="Event Date" type="date" value={lead.event_date || ""} transform={nullableString} />
              <AutoSaveField {...fieldProps("guest_estimate")} label="Guest Estimate" type="number" value={lead.guest_estimate ?? ""} transform={fkTransform} />
              <AutoSaveField {...fieldProps("budget")} label="Budget" type="text" inputMode="numeric" value={lead.budget ? String(Math.round(Number(lead.budget))) : ""} transform={nullableString} formatDisplay={formatWholeNumber} placeholder="e.g. 5,000" />
              <AutoSaveField
                {...fieldProps("service_style")}
                label="Service Style"
                type="select"
                value={lead.service_style || ""}
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
                value={lead.product ?? ""}
                transform={fkTransform}
                options={[{ value: "", label: "-- Select --" }, ...productLines.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <AutoSaveField
                {...fieldProps("assigned_to")}
                label="Assigned To"
                type="select"
                value={lead.assigned_to ?? ""}
                transform={fkTransform}
                options={[{ value: "", label: "-- Unassigned --" }, ...users.map((u) => ({ value: u.id, label: `${u.first_name} ${u.last_name}` }))]}
              />
              <AutoSaveField
                {...fieldProps("source")}
                label="Source"
                type="select"
                value={lead.source}
                options={sources.map((s) => ({ value: s.value, label: s.label }))}
              />
            </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Notes</h2>
          <AutoSaveField {...fieldProps("notes")} label="Notes" type="textarea" value={lead.notes} />
          {lead.status === "lost" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {lead.lost_reason_option_display && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Lost Reason</label>
                  <p className="text-sm text-muted-foreground py-2">{lead.lost_reason_option_display}</p>
                </div>
              )}
              <div className="md:col-span-2">
                <AutoSaveField {...fieldProps("lost_notes")} label="Lost Notes" type="textarea" value={lead.lost_notes || ""} />
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
            <div>Created: {new Date(lead.created_at).toLocaleString()}</div>
            {lead.contacted_at && <div>Contacted: {new Date(lead.contacted_at).toLocaleString()}</div>}
            {lead.qualified_at && <div>Qualified: {new Date(lead.qualified_at).toLocaleString()}</div>}
            {lead.proposal_sent_at && <div>Proposal Sent: {new Date(lead.proposal_sent_at).toLocaleString()}</div>}
            {lead.won_at && <div>Won: {new Date(lead.won_at).toLocaleString()}</div>}
            {lead.lost_at && <div>Lost: {new Date(lead.lost_at).toLocaleString()}</div>}
          </div>
        </CardContent>
      </Card>

      {/* Linked Quotes */}
      {lead.quotes && lead.quotes.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quotes</h2>
            <div className="space-y-3">
              {lead.quotes.map((q) => (
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
                  <span className="font-semibold text-foreground">{cs}{q.total}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked Event */}
      {lead.won_event && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Event</h2>
            <Link
              href={`/events/${lead.won_event}`}
              className="flex items-center justify-between p-3 border border-border rounded hover:bg-muted transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-foreground">{lead.won_event_name || `Event #${lead.won_event}`}</span>
                <Badge variant="success">Created</Badge>
              </div>
              <span className="text-sm text-primary">View Event &rarr;</span>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Reminders */}
      <LeadReminders leadId={lead.id} />

      {/* Activity Log */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Activity</h2>
          <ActivityTimeline leadId={lead.id} />
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
            {lead.quotes && lead.quotes.filter(q => q.status === "accepted").length > 0 && (
              <p className="text-xs text-muted-foreground text-center mb-4 bg-muted rounded-md px-3 py-2">
                The event will use data from the accepted quote.
              </p>
            )}
            <div className="space-y-3">
              <button
                disabled={transitioning}
                onClick={() => {
                  const acceptedQuote = lead.quotes?.find(q => q.status === "accepted");
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
                {new Date(addDays(selectedDays)).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })} at 9:00 AM
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Note (optional)</label>
              <Input
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
                      Due: {new Date(r.due_at).toLocaleString()}
                      {r.completed_at && ` | Completed: ${new Date(r.completed_at).toLocaleString()}`}
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
