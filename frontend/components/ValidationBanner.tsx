"use client";

import { CheckResult, Violation } from "@/lib/api";

interface Props {
  result: CheckResult;
}

function severityColor(severity: string) {
  return severity === "error"
    ? "bg-red-50 border-red-200 text-red-800"
    : "bg-amber-50 border-amber-200 text-amber-800";
}

function severityLabel(severity: string) {
  return severity === "error" ? "Violation" : "Warning";
}

function ViolationCard({ violation }: { violation: Violation }) {
  return (
    <div className={`border rounded-lg px-3 py-2 text-sm ${severityColor(violation.severity)}`}>
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
          <h3 className="text-sm font-semibold text-gray-700">Constraint Violations</h3>
          {result.violations.map((v, i) => (
            <ViolationCard key={i} violation={v} />
          ))}
        </>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          All clear — your portions are within all constraints.
        </div>
      )}
    </div>
  );
}
