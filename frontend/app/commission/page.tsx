"use client";

import { useMyCommission, useSiteSettings } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function pct(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "0%";
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export default function MyTargetsPage() {
  const { data, error, isLoading } = useMyCommission();
  const { data: settings } = useSiteSettings();
  const cs = settings?.currency_symbol || "£";

  if (error) return <p className="text-destructive">Error: {error.message}</p>;
  if (isLoading || !data) return <p className="text-muted-foreground">Loading…</p>;

  const attainment = parseFloat(data.attainment_pct) || 0;
  const fill = Math.max(0, Math.min(100, attainment));
  const hasTarget = parseFloat(data.target) > 0;
  const over = hasTarget && attainment >= 100;
  const overPct = Math.round(attainment - 100);
  const overBy = parseFloat(data.revenue) - parseFloat(data.target);
  const remaining = parseFloat(data.target) - parseFloat(data.revenue);
  const basisWord = data.basis === "booking_date" ? "booking date" : "event date";
  const attainmentVariant = over ? "success" : attainment >= 80 ? "warning" : "secondary";
  const statusLabel = !hasTarget
    ? "no target set"
    : over
    ? (overPct >= 1 ? `${overPct}% over target 🎉` : "Target hit 🎉")
    : "in progress";

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-foreground">My Targets</h1>

      {/* Target — the focus */}
      <Card>
        <CardContent className="p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {data.period}
          </p>

          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-6xl font-bold tabular-nums text-primary leading-none">
              {pct(data.attainment_pct)}
            </span>
            <span className="mb-1 text-sm text-muted-foreground">of target</span>
            <Badge variant={attainmentVariant} className="mb-1">{statusLabel}</Badge>
          </div>

          <Progress value={fill} className="mt-5 h-3" />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">{formatCurrency(data.revenue, cs)} won</span>
            <span className="tabular-nums">target {formatCurrency(data.target, cs)}</span>
          </div>
          {hasTarget && (
            <p className={`mt-2 text-sm font-medium tabular-nums ${over ? "text-success" : "text-muted-foreground"}`}>
              {over ? `${formatCurrency(overBy, cs)} over target` : `${formatCurrency(remaining, cs)} to go`}
            </p>
          )}

          {/* Reward */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Commission earned</p>
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {formatCurrency(data.commission, cs)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.plan && <Badge variant="secondary">{data.plan}</Badge>}
              <span className="text-xs text-muted-foreground">
                {data.deals} {data.deals === 1 ? "event" : "events"} · by {basisWord}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* How commission was earned */}
        <Card className="md:col-span-2">
          <CardContent className="p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              How your commission was earned
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Band</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.breakdown.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell>{pct(b.from_pct)}{b.to_pct !== null ? ` – ${pct(b.to_pct)}` : "+"}</TableCell>
                    <TableCell className="font-medium">{pct(b.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(b.revenue_in_band, cs)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(b.commission, cs)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} className="text-right font-semibold">Total</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{formatCurrency(data.commission, cs)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Lifetime */}
        <Card>
          <CardContent className="p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Lifetime</h2>
            <p className="text-3xl font-bold tabular-nums text-foreground">{formatCurrency(data.lifetime_revenue, cs)}</p>
            <p className="text-xs text-muted-foreground">revenue won</p>
            <p className="mt-4 text-2xl font-bold text-foreground tabular-nums">{data.lifetime_deals}</p>
            <p className="text-xs text-muted-foreground">events won</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
