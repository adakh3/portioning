"use client";

import { useState } from "react";
import { api, CommissionBandConfig } from "@/lib/api";
import { useSiteSettings, useCommissionBands, useSalesTargets, useUsers } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SELECT = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

/** Commission & targets config (Settings, admin/owner): model + rate + period +
 * basis, the accelerated bands, and each salesperson's target. */
export default function CommissionSettings() {
  const { data: settings, mutate: mutateSettings } = useSiteSettings();
  const { data: bands = [], mutate: mutateBands } = useCommissionBands();
  const { data: targets = [], mutate: mutateTargets } = useSalesTargets();
  const { data: users = [] } = useUsers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newPct, setNewPct] = useState("");
  const [newRate, setNewRate] = useState("");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const saveSetting = (data: Record<string, string>) =>
    run(async () => { await api.updateSiteSettings(data); await mutateSettings(); });

  const model = settings?.commission_model || "flat";
  const cs = settings?.currency_symbol || "£";

  const patchBand = (b: CommissionBandConfig, data: Partial<CommissionBandConfig>) =>
    run(async () => { await api.updateCommissionBand(b.id, data); await mutateBands(); });
  const removeBand = (b: CommissionBandConfig) =>
    run(async () => { await api.deleteCommissionBand(b.id); await mutateBands(); });
  const addBand = () =>
    run(async () => {
      await api.createCommissionBand({ min_attainment_pct: newPct || "0", rate: newRate || "0" });
      setNewPct(""); setNewRate("");
      await mutateBands();
    });

  const salespeople = users.filter((u) => u.role === "salesperson");
  const targetFor = (uid: number) => targets.find((t) => t.user === uid)?.amount ?? "";
  const setTarget = (uid: number, amount: string) =>
    run(async () => { await api.setSalesTarget(uid, amount || "0"); await mutateTargets(); });

  return (
    <div className="space-y-6">
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Model + rate + period + basis */}
      <Card>
        <CardHeader><CardTitle>Commission</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Model</span>
              <select className={SELECT + " w-full"} disabled={busy} value={model}
                onChange={(e) => saveSetting({ commission_model: e.target.value })}>
                {(settings?.commission_model_choices || []).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            {model === "flat" && (
              <label className="text-sm">
                <span className="block text-muted-foreground mb-1">Flat rate (%)</span>
                <Input type="number" step="0.01" min="0" disabled={busy}
                  defaultValue={settings?.commission_flat_rate}
                  onBlur={(e) => saveSetting({ commission_flat_rate: e.target.value || "0" })}
                  className="h-9" />
              </label>
            )}

            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Target period</span>
              <select className={SELECT + " w-full"} disabled={busy} value={settings?.target_period || "monthly"}
                onChange={(e) => saveSetting({ target_period: e.target.value })}>
                {(settings?.target_period_choices || []).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="block text-muted-foreground mb-1">Commission counts by</span>
              <select className={SELECT + " w-full"} disabled={busy} value={settings?.commission_basis || "event_date"}
                onChange={(e) => saveSetting({ commission_basis: e.target.value })}>
                {(settings?.commission_basis_choices || []).map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Accelerated bands */}
      {model === "accelerated" && (
        <Card>
          <CardHeader><CardTitle>Accelerated bands</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Each band applies its rate to revenue between its threshold (% of target) and the next.
              Start the lowest band at 0% so all revenue is covered.
            </p>
            <div className="space-y-2">
              {bands.map((b) => (
                <div key={b.id} className="flex items-center gap-2 border border-border rounded-md p-2">
                  <span className="text-xs text-muted-foreground">from</span>
                  <Input type="number" step="0.01" min="0" disabled={busy} defaultValue={b.min_attainment_pct}
                    onBlur={(e) => { const v = e.target.value; if (v !== b.min_attainment_pct) patchBand(b, { min_attainment_pct: v }); }}
                    className="h-8 w-24" aria-label="threshold %" />
                  <span className="text-xs text-muted-foreground">% of target →</span>
                  <Input type="number" step="0.01" min="0" disabled={busy} defaultValue={b.rate}
                    onBlur={(e) => { const v = e.target.value; if (v !== b.rate) patchBand(b, { rate: v }); }}
                    className="h-8 w-24" aria-label="rate %" />
                  <span className="text-xs text-muted-foreground">%</span>
                  <button type="button" disabled={busy} onClick={() => removeBand(b)}
                    className="text-destructive hover:text-destructive/80 text-xs px-1 ml-auto">✕</button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-2">
                <span className="text-xs text-muted-foreground">from</span>
                <Input type="number" step="0.01" min="0" placeholder="0" value={newPct} disabled={busy}
                  onChange={(e) => setNewPct(e.target.value)} className="h-8 w-24" aria-label="new threshold" />
                <span className="text-xs text-muted-foreground">% →</span>
                <Input type="number" step="0.01" min="0" placeholder="rate" value={newRate} disabled={busy}
                  onChange={(e) => setNewRate(e.target.value)} className="h-8 w-24" aria-label="new rate" />
                <Button type="button" size="sm" variant="outline" disabled={busy || !newRate} onClick={addBand}>
                  + Add band
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-rep targets */}
      <Card>
        <CardHeader><CardTitle>Targets</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            Each salesperson&apos;s revenue target per {settings?.target_period || "period"}.
          </p>
          {salespeople.length === 0 ? (
            <p className="text-muted-foreground text-sm">No salespeople in this organisation yet.</p>
          ) : (
            <div className="space-y-2">
              {salespeople.map((u) => (
                <div key={u.id} className="flex items-center gap-3 border border-border rounded-md p-2">
                  <span className="text-sm flex-1 min-w-[140px]">{u.first_name} {u.last_name}</span>
                  <span className="text-xs text-muted-foreground">{cs}</span>
                  <Input type="number" step="1" min="0" disabled={busy}
                    defaultValue={targetFor(u.id)} placeholder="0"
                    onBlur={(e) => { const v = e.target.value; if (v !== targetFor(u.id)) setTarget(u.id, v); }}
                    className="h-8 w-40" aria-label={`${u.first_name} target`} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
