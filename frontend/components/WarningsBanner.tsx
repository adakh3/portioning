"use client";

interface Props {
  warnings: string[];
  adjustments: string[];
}

export default function WarningsBanner({ warnings, adjustments }: Props) {
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="font-semibold text-red-800 mb-2">Warnings</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {adjustments.length > 0 && (
        <details className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <summary className="font-semibold text-blue-800 cursor-pointer">
            Adjustments Applied ({adjustments.length})
          </summary>
          <ul className="list-disc list-inside space-y-1 text-sm text-blue-700 mt-2">
            {adjustments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
