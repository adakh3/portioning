"use client";

interface Props {
  warnings: string[];
  adjustments: string[];
}

export default function WarningsBanner({ warnings, adjustments }: Props) {
  return (
    <div className="space-y-3">
      {warnings.length > 0 && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
          <h4 className="font-semibold text-destructive mb-2">Warnings</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-destructive/90">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {adjustments.length > 0 && (
        <details className="bg-info/10 border border-info/20 rounded-lg p-4">
          <summary className="font-semibold text-info cursor-pointer">
            Adjustments Applied ({adjustments.length})
          </summary>
          <ul className="list-disc list-inside space-y-1 text-sm text-info/90 mt-2">
            {adjustments.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
