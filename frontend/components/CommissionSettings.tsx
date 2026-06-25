"use client";

import { useState } from "react";
import { api, CommissionPlanConfig, CommissionBandConfig } from "@/lib/api";
import {
  useSiteSettings, useCommissionPlans, useCommissionBands, useSalesTargets, useUsers,
} from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SELECT = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

/** Commission & targets config (Settings, admin/owner): period + basis (org-wide),
 * named commission plans with their bands, and each salesperson's plan + target. */
export default function CommissionSettings() {
  const { data: settings, mutate: mutateSettings } = useSiteSettings();
  const { data: plans = [], mutate: mutatePlans } = useCommissionPlans();
  const { data: bands = [], mutate: mutateBands } = useCommissionBands();
  const { data: targets = [], mutate: mutateTargets } = useSalesTargets();
  const { data: users = [] } = useUsers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newPlanName, setNewPlanName] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  const cs = settings?.currency_symbol || "£";
  const modelChoices = settings?.commission_model_choices || [];
  const defaultPlanId = plans.find((p) => p.is_default)?.id;

  const saveSetting = (data: Record<string, string>) =>
    run(async () => { await api.updateSiteSettings(data); await mutateSettings(); });

  // plans
  const patchPlan = (p: CommissionPlanConfig, data: Partial<CommissionPlanConfig>) =>
    run(async () => { await api.updateCommissionPlan(p.id, data); await mutatePlans(); });
  const removePlan = (p: CommissionPlanConfig) =>
    run(async () => { await api.deleteCommissionPlan(p.id); await mutatePlans(); await mutateTargets(); });
  const addPlan = () => {
    const name = newPlanName.trim();
    if (!name) return;
    setNewPlanName("");
    return run(async () => {
      await api.createCommissionPlan({ name, commission_model: "flat", commission_flat_rate: "0" });
      await mutatePlans();
    });
  };

  // bands (grouped by plan)
  const bandsFor = (planId: number) => bands.filter((b) => b.plan === planId);
  const patchBand = (b: CommissionBandConfig, data: Partial<CommissionBandConfig>) =>
    run(async () => { await api.updateCommissionBand(b.id, data); await mutateBands(); });
  const removeBand = (b: CommissionBandConfig) =>
    run(async () => { await api.deleteCommissionBand(b.id); await mutateBands(); });
  const addBand = (planId: number) =>
    run(async () => {
      await api.createCommissionBand({ plan: planId, min_attainment_pct: "0", rate: "0" });
      await mutateBands();
    });

  // targets
  const salespeople = users.filter((u) => u.role === "salesperson");
  const targetFor = (uid: number) => targets.find((t) => t.user === uid);
  const setTarget = (uid: number, data: { amount?: string; plan?: number | null }) =>
    run(async () => { await api.setSalesTarget(uid, data); await mutateTargets(); });

  return (
    <div className="space-y-6">
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Org-wide: period + basis */}
      <Card>
        <CardHeader><CardTitle>Period &amp; basis</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Target period</span>
              <select className={SELECT + " w-full"} disabled={busy} value={settings?.target_period || "monthly"}
                onChange={(e) => saveSetting({ target_period: e.target.value })} aria-label="Target period">
                {(settings?.target_period_choices || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Commission counts by</span>
              <select className={SELECT + " w-full"} disabled={busy} value={settings?.commission_basis || "event_date"}
                onChange={(e) => saveSetting({ commission_basis: e.target.value })}>
                {(settings?.commission_basis_choices || []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Plans */}
      <Card>
        <CardHeader><CardTitle>Commission plans</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Define rate structures (e.g. by seniority) and assign salespeople below. The
            <strong> Default</strong> plan applies to anyone unassigned.
          </p>
          <div className="space-y-4">
            {plans.map((p) => (
              <div key={p.id} className="border border-border rounded-md p-3 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input defaultValue={p.name} disabled={busy || p.is_default}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) patchPlan(p, { name: v }); }}
                    className="h-8 w-44 font-medium" aria-label={`${p.name} name`} />
                  {p.is_default && <span className="text-xs text-muted-foreground">(default)</span>}
                  <select className={SELECT + " h-8"} disabled={busy} value={p.commission_model}
                    onChange={(e) => patchPlan(p, { commission_model: e.target.value })} aria-label={`${p.name} model`}>
                    {modelChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  {p.commission_model === "flat" && (
                    <div className="flex items-center gap-1">
                      <Input type="number" step="0.01" min="0" disabled={busy} defaultValue={p.commission_flat_rate}
                        onBlur={(e) => { const v = e.target.value || "0"; if (v !== p.commission_flat_rate) patchPlan(p, { commission_flat_rate: v }); }}
                        className="h-8 w-20" aria-label={`${p.name} rate`} />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  )}
                  {!p.is_default && (
                    <button type="button" disabled={busy} onClick={() => removePlan(p)}
                      className="text-destructive hover:text-destructive/80 text-xs px-1 ml-auto">✕ delete plan</button>
                  )}
                </div>

                {p.commission_model === "accelerated" && (
                  <div className="pl-1 space-y-1">
                    {bandsFor(p.id).map((b) => (
                      <div key={b.id} className="flex items-center gap-2 text-sm">
                        <span className="text-xs text-muted-foreground">from</span>
                        <Input type="number" step="0.01" min="0" disabled={busy} defaultValue={b.min_attainment_pct}
                          onBlur={(e) => { const v = e.target.value; if (v !== b.min_attainment_pct) patchBand(b, { min_attainment_pct: v }); }}
                          className="h-7 w-20" aria-label="threshold %" />
                        <span className="text-xs text-muted-foreground">% →</span>
                        <Input type="number" step="0.01" min="0" disabled={busy} defaultValue={b.rate}
                          onBlur={(e) => { const v = e.target.value; if (v !== b.rate) patchBand(b, { rate: v }); }}
                          className="h-7 w-20" aria-label="rate %" />
                        <span className="text-xs text-muted-foreground">%</span>
                        <button type="button" disabled={busy} onClick={() => removeBand(b)}
                          className="text-destructive hover:text-destructive/80 text-xs px-1">✕</button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => addBand(p.id)} className="h-7">
                      + Add band
                    </Button>
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1">
              <Input placeholder="New plan name (e.g. Senior)" value={newPlanName} disabled={busy}
                onChange={(e) => setNewPlanName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPlan(); } }}
                className="h-8 max-w-xs" />
              <Button type="button" size="sm" variant="outline" disabled={busy || !newPlanName.trim()} onClick={addPlan}>
                + Add plan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Salespeople: plan + target */}
      <Card>
        <CardHeader><CardTitle>Salespeople</CardTitle></CardHeader>
        <CardContent>
          {salespeople.length === 0 ? (
            <p className="text-muted-foreground text-sm">No salespeople in this organisation yet.</p>
          ) : (
            <div className="space-y-2">
              {salespeople.map((u) => {
                const t = targetFor(u.id);
                return (
                  <div key={u.id} className="flex items-center gap-3 border border-border rounded-md p-2 flex-wrap">
                    <span className="text-sm flex-1 min-w-[120px]">{u.first_name} {u.last_name}</span>
                    <select className={SELECT + " h-8"} disabled={busy} value={t?.plan ?? defaultPlanId ?? ""}
                      onChange={(e) => setTarget(u.id, { plan: Number(e.target.value) })} aria-label={`${u.first_name} plan`}>
                      {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <span className="text-xs text-muted-foreground">{cs}</span>
                    <Input type="number" step="1" min="0" disabled={busy} defaultValue={t?.amount ?? ""} placeholder="0"
                      onBlur={(e) => { const v = e.target.value; if (v !== (t?.amount ?? "")) setTarget(u.id, { amount: v || "0" }); }}
                      className="h-8 w-36" aria-label={`${u.first_name} target`} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
