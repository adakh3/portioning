"use client";

import { CheckResult, Violation } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  result: CheckResult;
}

function severityColor(severity: string) {
  return severity === "error"
    ? "bg-destructive/10 border-destructive/20 text-destructive"
    : "bg-warning/10 border-warning/20 text-warning";
}

function severityLabel(severity: string) {
  return severity === "error" ? "Violation" : "Warning";
}

function ViolationCard({ violation }: { violation: Violation }) {
  return (
    <div className={cn("border rounded-lg px-3 py-2 text-sm", severityColor(violation.severity))}>
      <span className="font-medium">{severityLabel(violation.severity)}:</span>{" "}
      {violation.message}
    </div>
  );
}

export default function ValidationBanner({ result }: Props) {
  const hasViolations = result.violations.length > 0;

  return (
    <div className="space-y-2">
      {hasViolations ? (
        <>
          <h3 className="text-sm font-semibold text-foreground">Constraint Violations</h3>
          {result.violations.map((v, i) => (
            <ViolationCard key={i} violation={v} />
          ))}
        </>
      ) : (
        <div className="bg-success/10 border border-success/20 rounded-lg px-4 py-3 text-sm text-success">
          All clear — your portions are within all constraints.
        </div>
      )}
    </div>
  );
}
