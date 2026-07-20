"use client";

import { useState } from "react";
import { api, CommissionPlanConfig, CommissionBandConfig } from "@/lib/api";
import {
  useSiteSettings, useCommissionPlans, useCommissionBands, useSalesTargetGrid,
} from "@/lib/hooks";
import { useOrgLocale } from "@/lib/orgLocale";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newPlanName, setNewPlanName] = useState("");
  const [fiscalYear, setFiscalYear] = useState<number | undefined>(undefined);
  const { data: grid, mutate: mutateGrid } = useSalesTargetGrid(fiscalYear);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  const cs = useOrgLocale().symbol;
  const modelChoices = settings?.commission_model_choices || [];
  const defaultPlanId = plans.find((p) => p.is_default)?.id;
  const periodWord = ({ monthly: "month", quarterly: "quarter", yearly: "year" } as Record<string, string>)[settings?.target_period || "monthly"] || "period";

  const saveSetting = (data: Record<string, string | number>) =>
    run(async () => {
      await api.updateSiteSettings(data);
      await mutateSettings();
      // target_period / fiscal-year start change the grid's shape on the backend,
      // but the grid's SWR key (fiscalYear) doesn't change — refetch it explicitly.
      if ("target_period" in data || "fiscal_year_start_month" in data) await mutateGrid();
    });

  // plans
  const patchPlan = (p: CommissionPlanConfig, data: Partial<CommissionPlanConfig>) =>
    run(async () => { await api.updateCommissionPlan(p.id, data); await mutatePlans(); });
  const removePlan = (p: CommissionPlanConfig) =>
    run(async () => { await api.deleteCommissionPlan(p.id); await mutatePlans(); await mutateGrid(); });
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

  // targets (period grid)
  const setRepPlan = (uid: number, plan: number | null) =>
    run(async () => { await api.setRepPlan(uid, plan); await mutateGrid(); });
  const setCell = (uid: number, index: number, amount: string) =>
    run(async () => {
      if (!grid) return;
      await api.setSalesTargetCell(uid, grid.fiscal_year, index, amount);
      await mutateGrid();
    });
  const colTotal = (index: number) =>
    (grid?.reps || []).reduce((sum, r) => sum + (parseFloat(r.cells[index] || "0") || 0), 0);
  const grandTotal = (grid?.reps || []).reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
  const fmt = (n: number) => `${cs}${Math.round(n).toLocaleString()}`;

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
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Financial year starts</span>
              <select className={SELECT + " w-full"} disabled={busy} value={String(settings?.fiscal_year_start_month ?? 1)}
                onChange={(e) => saveSetting({ fiscal_year_start_month: Number(e.target.value) })}
                aria-label="Financial year start month">
                {(settings?.fiscal_year_start_month_choices || []).map((c) => <option key={c.value} value={String(c.value)}>{c.label}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">Drives the “This year” total and yearly targets.</span>
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

      {/* Targets: per-rep plan + a period-wise grid (shape follows the period above) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle>Targets</CardTitle>
            {grid && (
              <div className="flex items-center gap-2 text-sm">
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={busy}
                  onClick={() => setFiscalYear(grid.fiscal_year - 1)} aria-label="Previous year">◀</Button>
                <span className="font-medium tabular-nums min-w-[64px] text-center">{grid.fiscal_year_label}</span>
                <Button variant="outline" size="sm" className="h-7 px-2" disabled={busy}
                  onClick={() => setFiscalYear(grid.fiscal_year + 1)} aria-label="Next year">▶</Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Each salesperson&apos;s plan and their revenue target per <strong>{periodWord}</strong>{" "}
            (change the period &amp; financial-year start in <em>Period &amp; basis</em> above).
          </p>
          {!grid ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : grid.reps.length === 0 ? (
            <p className="text-muted-foreground text-sm">No salespeople in this organisation yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium text-muted-foreground sticky left-0 bg-card">Salesperson</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground">Plan</th>
                    {grid.columns.map((c) => (
                      <th key={c.index} className="py-2 px-2 font-medium text-muted-foreground text-right whitespace-nowrap">{c.label}</th>
                    ))}
                    <th className="py-2 pl-2 font-medium text-muted-foreground text-right border-l border-border">Annual</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.reps.map((r) => (
                    <tr key={r.user_id} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3 font-medium sticky left-0 bg-card whitespace-nowrap">{r.user_name}</td>
                      <td className="py-1.5 px-2">
                        <select className={SELECT + " h-8"} disabled={busy} value={r.plan ?? defaultPlanId ?? ""}
                          onChange={(e) => setRepPlan(r.user_id, Number(e.target.value))} aria-label={`${r.user_name} plan`}>
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      {grid.columns.map((c) => (
                        <td key={c.index} className="py-1.5 px-1">
                          <Input
                            key={`cell-${r.user_id}-${grid.fiscal_year}-${c.index}-${r.cells[c.index]}`}
                            type="number" step="1" min="0" disabled={busy}
                            defaultValue={parseFloat(r.cells[c.index] || "0") ? r.cells[c.index] : ""}
                            placeholder="0"
                            onBlur={(e) => { const v = e.target.value || "0"; if (v !== (r.cells[c.index] ?? "0")) setCell(r.user_id, c.index, v); }}
                            className="h-8 w-28 text-right" aria-label={`${r.user_name} ${c.label}`} />
                        </td>
                      ))}
                      <td className="py-1.5 pl-2 text-right font-semibold tabular-nums border-l border-border whitespace-nowrap">{fmt(parseFloat(r.total))}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-semibold">
                    <td className="py-2 pr-3 sticky left-0 bg-card">Team</td>
                    <td></td>
                    {grid.columns.map((c) => (
                      <td key={c.index} className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(colTotal(c.index))}</td>
                    ))}
                    <td className="py-2 pl-2 text-right tabular-nums border-l border-border whitespace-nowrap">{fmt(grandTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
