"use client";

import { CheckResult, Violation, ComparisonRow } from "@/lib/api";

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

function deltaColor(absPct: number) {
  if (absPct <= 10) return "text-green-600";
  return "text-amber-600";
}

function ViolationCard({ violation }: { violation: Violation }) {
  return (
    <div className={`border rounded-lg px-3 py-2 text-sm ${severityColor(violation.severity)}`}>
      <span className="font-medium">{severityLabel(violation.severity)}:</span>{" "}
      {violation.message}
    </div>
  );
}

function ComparisonTable({ rows, userTotals, engineTotals }: {
  rows: ComparisonRow[];
  userTotals: CheckResult["user_totals"];
  engineTotals: CheckResult["engine_totals"];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500 text-xs uppercase tracking-wide">
            <th className="py-2 pr-4">Dish</th>
            <th className="py-2 pr-4">Category</th>
            <th className="py-2 pr-4 text-right">Your Portion</th>
            <th className="py-2 pr-4 text-right">Engine Rec</th>
            <th className="py-2 text-right">Delta</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const absPct = Math.abs(row.delta_percent);
            const suffix = row.unit === "qty" ? "pcs" : "g";
            return (
              <tr key={row.dish_id} className="border-b border-gray-100">
                <td className="py-2 pr-4 text-gray-800">{row.dish_name}</td>
                <td className="py-2 pr-4 text-gray-500">{row.category}</td>
                <td className="py-2 pr-4 text-right font-mono">{row.user_grams}{suffix}</td>
                <td className="py-2 pr-4 text-right font-mono">{row.engine_grams}{suffix}</td>
                <td className={`py-2 text-right font-mono ${deltaColor(absPct)}`}>
                  {row.delta_grams > 0 ? "+" : ""}
                  {row.delta_grams}{suffix}
                  <span className="text-xs ml-1">
                    ({row.delta_percent > 0 ? "+" : ""}
                    {row.delta_percent}%)
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-300 font-medium">
            <td className="py-2 pr-4" colSpan={2}>Total per person</td>
            <td className="py-2 pr-4 text-right font-mono">
              {userTotals.food_per_person_grams}g
            </td>
            <td className="py-2 pr-4 text-right font-mono">
              {engineTotals.food_per_person_grams}g
            </td>
            <td className={`py-2 text-right font-mono ${deltaColor(
              Math.abs(
                engineTotals.food_per_person_grams
                  ? ((userTotals.food_per_person_grams - engineTotals.food_per_person_grams) /
                      engineTotals.food_per_person_grams) *
                    100
                  : 0
              )
            )}`}>
              {userTotals.food_per_person_grams - engineTotals.food_per_person_grams > 0 ? "+" : ""}
              {(userTotals.food_per_person_grams - engineTotals.food_per_person_grams).toFixed(1)}g
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function CheckResultsDisplay({ result }: Props) {
  const hasViolations = result.violations.length > 0;

  return (
    <div className="space-y-4">
      {/* Violations banner */}
      {hasViolations ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Constraint Violations</h3>
          {result.violations.map((v, i) => (
            <ViolationCard key={i} violation={v} />
          ))}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
          All clear — your portions are within all constraints.
        </div>
      )}

      {/* Comparison table */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Comparison with Engine Recommendations
        </h3>
        <ComparisonTable
          rows={result.comparison}
          userTotals={result.user_totals}
          engineTotals={result.engine_totals}
        />
      </div>
    </div>
  );
}
