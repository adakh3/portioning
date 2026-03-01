"use client";

import { GuestMix } from "@/lib/api";
import { Input } from "@/components/ui/input";

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
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-3">Guest Mix</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Gents</label>
          <Input
            type="number"
            min={0}
            value={guests.gents}
            onChange={(e) => update("gents", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1">Ladies</label>
          <Input
            type="number"
            min={0}
            value={guests.ladies}
            onChange={(e) => update("ladies", e.target.value)}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground mt-2">Total guests: {total}</p>

      <div className="mt-3 pt-3 border-t border-border flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={bigEaters}
            onChange={(e) => onBigEatersChange(e.target.checked)}
            className="rounded border-input"
          />
          Big eaters
        </label>
        {bigEaters && (
          <div className="flex items-center gap-1.5">
            <label className="text-sm text-muted-foreground">Increase by</label>
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
              className="w-16 border border-input rounded-md px-2 py-1 text-sm"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        )}
      </div>
    </div>
  );
}
