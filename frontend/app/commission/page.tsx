"use client";

import { useMyCommission, useSiteSettings } from "@/lib/hooks";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function pct(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "0%";
  // whole number unless there's a meaningful fraction
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

function StatCard({ label, value, sub, emphasis }: { label: string; value: string; sub?: string; emphasis?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`mt-1 font-bold ${emphasis ? "text-3xl text-primary" : "text-2xl text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function CommissionPage() {
  const { data, error, isLoading } = useMyCommission();
  const { data: settings } = useSiteSettings();
  const cs = settings?.currency_symbol || "£";

  if (error) return <p className="text-destructive">Error: {error.message}</p>;
  if (isLoading || !data) return <p className="text-muted-foreground">Loading commission…</p>;

  const attainment = parseFloat(data.attainment_pct) || 0;
  const fill = Math.max(0, Math.min(100, attainment));
  const overTarget = attainment > 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">My Commission</h1>
          <p className="text-muted-foreground mt-1">
            {data.period} · {data.deals} {data.deals === 1 ? "deal" : "deals"} won
          </p>
        </div>
        <Badge variant={data.model === "accelerated" ? "success" : "secondary"}>
          {data.model === "accelerated" ? "Accelerated" : "Flat rate"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Commission earned" value={formatCurrency(data.commission, cs)} emphasis />
        <StatCard label="Revenue won" value={formatCurrency(data.revenue, cs)} />
        <StatCard label="Target" value={formatCurrency(data.target, cs)} />
        <StatCard label="Attainment" value={pct(data.attainment_pct)} sub={overTarget ? "over target 🎉" : "to target"} />
      </div>

      {/* Progress to target */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Progress to target</h2>
            <span className="text-sm text-muted-foreground">
              {formatCurrency(data.revenue, cs)} / {formatCurrency(data.target, cs)}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${overTarget ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${fill}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{pct(data.attainment_pct)} of target</p>
        </CardContent>
      </Card>

      {/* How the commission was calculated */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            How it was calculated
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Band (of target)</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead className="text-right">Revenue in band</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.breakdown.map((b, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {pct(b.from_pct)}{b.to_pct !== null ? ` – ${pct(b.to_pct)}` : "+"}
                  </TableCell>
                  <TableCell>{pct(b.rate)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(b.revenue_in_band, cs)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(b.commission, cs)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="font-semibold text-right">Total</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(data.commission, cs)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Lifetime */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Lifetime revenue" value={formatCurrency(data.lifetime_revenue, cs)} />
        <StatCard label="Lifetime deals won" value={String(data.lifetime_deals)} />
      </div>
    </div>
  );
}
