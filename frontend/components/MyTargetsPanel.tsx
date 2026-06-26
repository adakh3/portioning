"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import CountUp from "react-countup";
import confetti from "canvas-confetti";

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

const rise = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

/** The gamified target + commission view. Rendered at the top of a salesperson's
 *  dashboard (previously its own /commission page). */
export default function MyTargetsPanel() {
  const { data, error, isLoading } = useMyCommission();
  const { data: settings } = useSiteSettings();
  const cs = settings?.currency_symbol || "£";

  const attainment = data ? parseFloat(data.attainment_pct) || 0 : 0;
  const fill = Math.max(0, Math.min(100, attainment));
  const hasTarget = data ? parseFloat(data.target) > 0 : false;
  const over = hasTarget && attainment >= 100;

  const [animFill, setAnimFill] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimFill(fill), 120);
    return () => clearTimeout(t);
  }, [fill]);
  useEffect(() => {
    if (!over) return;
    const t = setTimeout(() => confetti({ particleCount: 110, spread: 75, origin: { y: 0.35 } }), 450);
    return () => clearTimeout(t);
  }, [over]);

  // In the dashboard context, fail quietly — the rest of the dashboard still renders.
  if (error || isLoading || !data) return null;

  const overPct = Math.round(attainment - 100);
  const overBy = parseFloat(data.revenue) - parseFloat(data.target);
  const remaining = parseFloat(data.target) - parseFloat(data.revenue);
  const basisWord = data.basis === "booking_date" ? "booking date" : "event date";
  const statusLabel = !hasTarget
    ? "no target set"
    : over
    ? (overPct >= 1 ? `${overPct}% over target 🎉` : "Target hit 🎉")
    : "in progress";
  const attDecimals = Number.isInteger(attainment) ? 0 : 1;

  return (
    <div className="space-y-4">
      {/* Target — the focus, on the brand colour so it pops */}
      <motion.div {...rise} transition={{ duration: 0.4 }}>
        <div className="rounded-2xl bg-primary p-6 sm:p-8 text-primary-foreground shadow-md">
          <p className="text-xs font-medium uppercase tracking-widest text-primary-foreground/60">{data.period}</p>

          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span className="text-7xl font-extrabold tabular-nums leading-none">
              <CountUp end={attainment} duration={0.9} decimals={attDecimals} suffix="%" />
            </span>
            <span className="mb-1.5 text-sm text-primary-foreground/70">of target</span>
            <Badge variant="secondary" className="mb-1.5">{statusLabel}</Badge>
          </div>

          <Progress
            value={animFill}
            className="mt-6 h-3 bg-primary-foreground/20"
            indicatorClassName="bg-primary-foreground"
          />
          <div className="mt-1.5 flex justify-between text-xs text-primary-foreground/70">
            <span className="tabular-nums">{formatCurrency(data.revenue, cs)} won</span>
            <span className="tabular-nums">target {formatCurrency(data.target, cs)}</span>
          </div>
          {hasTarget && (
            <p className="mt-2 text-sm font-semibold tabular-nums text-primary-foreground/90">
              {over ? `${formatCurrency(overBy, cs)} over target 🎉` : `${formatCurrency(remaining, cs)} to go`}
            </p>
          )}

          {/* Reward */}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-primary-foreground/20 pt-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-primary-foreground/60">Commission earned</p>
              <p className="text-4xl font-extrabold tabular-nums">
                <CountUp end={parseFloat(data.commission)} duration={1.1} separator="," decimals={2} prefix={cs} />
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {data.plan && <Badge variant="secondary">{data.plan}</Badge>}
              <span className="text-xs text-primary-foreground/70">
                {data.deals} {data.deals === 1 ? "event" : "events"} · by {basisWord}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div {...rise} transition={{ duration: 0.4, delay: 0.1 }} className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

        {/* This year (org's financial year) */}
        <Card>
          <CardContent className="p-6">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">This year</h2>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{data.year_label}</span>
            </div>
            <p className="text-3xl font-bold tabular-nums text-foreground">{formatCurrency(data.year_revenue, cs)}</p>
            <p className="text-xs text-muted-foreground">revenue won</p>
            <p className="mt-4 text-2xl font-bold text-foreground tabular-nums">{data.year_deals}</p>
            <p className="text-xs text-muted-foreground">events won</p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
