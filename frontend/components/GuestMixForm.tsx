"use client";

import { GuestMix } from "@/lib/api";

interface Props {
  guests: GuestMix;
  onChange: (guests: GuestMix) => void;
  bigEaters: boolean;
  onBigEatersChange: (enabled: boolean) => void;
  bigEatersPercentage: number;
  onBigEatersPercentageChange: (pct: number) => void;
}

export default function GuestMixForm({
  guests,
  onChange,
  bigEaters,
  onBigEatersChange,
  bigEatersPercentage,
  onBigEatersPercentageChange,
}: Props) {
  const update = (field: keyof GuestMix, value: string) => {
    const num = parseInt(value) || 0;
    onChange({ ...guests, [field]: Math.max(0, num) });
  };

  const total = guests.gents + guests.ladies;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h3 className="font-semibold text-gray-900 mb-3">Guest Mix</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Gents</label>
          <input
            type="number"
            min={0}
            value={guests.gents}
            onChange={(e) => update("gents", e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Ladies</label>
          <input
            type="number"
            min={0}
            value={guests.ladies}
            onChange={(e) => update("ladies", e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>
      </div>
      <p className="text-sm text-gray-500 mt-2">Total guests: {total}</p>

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={bigEaters}
            onChange={(e) => onBigEatersChange(e.target.checked)}
            className="rounded border-gray-300"
          />
          Big eaters
        </label>
        {bigEaters && (
          <div className="flex items-center gap-1.5">
            <label className="text-sm text-gray-500">Increase by</label>
            <input
              type="number"
              min={0}
              max={100}
              value={bigEatersPercentage}
              onChange={(e) =>
                onBigEatersPercentageChange(
                  Math.max(0, Math.min(100, parseInt(e.target.value) || 0))
                )
              }
              className="w-16 border border-gray-300 rounded px-2 py-1 text-sm"
            />
            <span className="text-sm text-gray-500">%</span>
          </div>
        )}
      </div>
    </div>
  );
}
