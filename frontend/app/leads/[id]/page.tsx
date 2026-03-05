"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, Lead, Account, AuthUser, BudgetRangeOption, ProductLine } from "@/lib/api";
import { useLead, useSiteSettings, useBudgetRanges, useProductLines, useUsers, useSources, useEventTypes, useServiceStyles, useLeadStatuses } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";


const STATUS_BADGE_VARIANT: Record<string, "info" | "warning" | "default" | "success" | "secondary"> = {
  new: "info",
  contacted: "warning",
  qualified: "default",
  converted: "success",
  lost: "secondary",
};

const TRANSITION_LABELS: Record<string, { label: string; variant: "default" | "success" | "warning" | "secondary" | "destructive" }> = {
  contacted: { label: "Mark Contacted", variant: "warning" },
  qualified: { label: "Mark Qualified", variant: "default" },
  converted: { label: "Convert to Quote", variant: "success" },
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
  status: FieldStatus;
  setStatus: (s: FieldStatus) => void;
}) {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
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

  const handleBlur = () => save(localValue);
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
          type={type}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          required={required}
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
  const { data: budgetRanges = [] } = useBudgetRanges();
  const { data: productLines = [] } = useProductLines();
  const { data: users = [] } = useUsers();
  const { data: sources = [] } = useSources();
  const { data: eventTypes = [] } = useEventTypes();
  const { data: serviceStyles = [] } = useServiceStyles();
  const { data: leadStatuses = [] } = useLeadStatuses();
  const [error, setError] = useState("");
  const [transitioning, setTransitioning] = useState(false);
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
    setTransitioning(true);
    setError("");
    try {
      if (newStatus === "converted") {
        const quote = await api.convertLead(lead.id);
        router.push(`/quotes/${quote.id}`);
        return;
      }
      const updated = await api.transitionLead(lead.id, newStatus);
      mutateLead(updated, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to transition");
    } finally {
      setTransitioning(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (loadError && !lead) return <p className="text-destructive">Error: {loadError.message}</p>;
  if (!lead) return <p className="text-muted-foreground">Lead not found.</p>;

  const availableTransitions = leadStatuses.map((s) => s.value).filter((s) => s !== lead.status);
  const cs = settings.currency_symbol;

  const fieldProps = (field: string) => ({
    field,
    leadId: lead.id,
    mutateLead,
    status: fieldStatus[field] || "idle" as FieldStatus,
    setStatus: setStatus(field),
  });

  return (
    <div>
      <Link href="/leads" className="text-sm text-primary hover:underline mb-4 inline-block">&larr; Back to Leads</Link>

      {error && <p className="text-destructive mb-4">{error}</p>}

      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <AutoSaveField
                  {...fieldProps("contact_name")}
                  label=""
                  type="text"
                  value={lead.contact_name}
                  required
                />
                <Badge variant={STATUS_BADGE_VARIANT[lead.status] || "secondary"} className="mt-6">
                  {lead.status_display}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {lead.event_type_display}
                {lead.event_date && ` \u00b7 ${lead.event_date}`}
                {lead.guest_estimate && ` \u00b7 ${lead.guest_estimate} guests`}
              </p>
            </div>
            {availableTransitions.length > 0 && (
              <div className="flex flex-wrap gap-2 shrink-0">
                {availableTransitions.map((status) => {
                  const { label, variant } = TRANSITION_LABELS[status] || { label: status, variant: "default" as const };
                  return (
                    <Button
                      key={status}
                      size="sm"
                      onClick={() => handleTransition(status)}
                      disabled={transitioning}
                      variant={variant}
                    >
                      {transitioning ? "..." : label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <AutoSaveField
              {...fieldProps("source")}
              label="Source"
              type="select"
              value={lead.source}
              options={sources.map((s) => ({ value: s.value, label: s.label }))}
            />
            <AutoSaveField
              {...fieldProps("event_type")}
              label="Event Type"
              type="select"
              value={lead.event_type}
              options={eventTypes.map((et) => ({ value: et.value, label: et.label }))}
            />
            <AutoSaveField {...fieldProps("event_date")} label="Event Date" type="date" value={lead.event_date || ""} transform={nullableString} />
            <AutoSaveField {...fieldProps("guest_estimate")} label="Guest Estimate" type="number" value={lead.guest_estimate ?? ""} transform={fkTransform} />
            <AutoSaveField
              {...fieldProps("budget_range")}
              label="Budget Range"
              type="select"
              value={lead.budget_range ?? ""}
              transform={fkTransform}
              options={[{ value: "", label: "-- Select --" }, ...budgetRanges.map((b) => ({ value: b.id, label: b.label }))]}
            />
            <AutoSaveField
              {...fieldProps("service_style")}
              label="Service Style"
              type="select"
              value={lead.service_style || ""}
              options={[{ value: "", label: "-- Select --" }, ...serviceStyles.map((ss) => ({ value: ss.value, label: ss.label }))]}
            />
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
            <div className="md:col-span-2">
              <AutoSaveField {...fieldProps("notes")} label="Notes" type="textarea" value={lead.notes} />
            </div>
            {lead.status === "lost" && (
              <div className="md:col-span-2">
                <AutoSaveField {...fieldProps("lost_reason")} label="Lost Reason" type="textarea" value={lead.lost_reason || ""} />
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="mt-6 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-foreground mb-2">Timeline</h3>
            <div className="text-sm text-muted-foreground space-y-1">
              <div>Created: {new Date(lead.created_at).toLocaleString()}</div>
              {lead.contacted_at && <div>Contacted: {new Date(lead.contacted_at).toLocaleString()}</div>}
              {lead.qualified_at && <div>Qualified: {new Date(lead.qualified_at).toLocaleString()}</div>}
              {lead.converted_at && <div>Converted: {new Date(lead.converted_at).toLocaleString()}</div>}
              {lead.lost_at && <div>Lost: {new Date(lead.lost_at).toLocaleString()}</div>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Quotes */}
      {lead.quotes && lead.quotes.length > 0 && (
        <Card className="mb-6">
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">Quotes</h2>
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

    </div>
  );
}
