"use client";

import { useState, useEffect } from "react";
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
  const total = guests.gents + guests.ladies;
  const is5050 = total === 0 || (guests.gents === Math.ceil(total / 2) && guests.ladies === Math.floor(total / 2));
  const [customSplit, setCustomSplit] = useState(!is5050);

  useEffect(() => {
    if (total > 0 && !is5050) {
      setCustomSplit(true);
    }
  }, []);

  const handleTotalChange = (value: string) => {
    const num = Math.max(0, parseInt(value) || 0);
    if (customSplit) {
      // Keep ratio when total changes in custom mode
      const ratio = total > 0 ? guests.gents / total : 0.5;
      const gents = Math.round(num * ratio);
      onChange({ ...guests, gents, ladies: num - gents });
    } else {
      onChange({ ...guests, gents: Math.ceil(num / 2), ladies: Math.floor(num / 2) });
    }
  };

  const handleGentsChange = (value: string) => {
    const gents = Math.max(0, parseInt(value) || 0);
    onChange({ ...guests, gents, ladies: Math.max(0, total - gents) });
  };

  const handleLadiesChange = (value: string) => {
    const ladies = Math.max(0, parseInt(value) || 0);
    onChange({ ...guests, ladies, gents: Math.max(0, total - ladies) });
  };

  const handleToggleSplit = (enabled: boolean) => {
    setCustomSplit(enabled);
    if (!enabled) {
      // Reset to 50/50
      onChange({ ...guests, gents: Math.ceil(total / 2), ladies: Math.floor(total / 2) });
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="font-semibold text-foreground mb-3">Guest Mix</h3>
      <div>
        <label className="block text-sm text-muted-foreground mb-1">Total Guests</label>
        <Input
          type="number"
          min={1}
          value={total || ""}
          onChange={(e) => handleTotalChange(e.target.value)}
          placeholder="Enter total guests"
          className="max-w-[200px]"
        />
      </div>

      <div className="mt-3">
        <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={customSplit}
            onChange={(e) => handleToggleSplit(e.target.checked)}
            className="rounded border-input"
          />
          Customise split
        </label>
        {customSplit && (
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Gents</label>
              <Input
                type="number"
                min={0}
                max={total}
                value={guests.gents}
                onChange={(e) => handleGentsChange(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Ladies</label>
              <Input
                type="number"
                min={0}
                max={total}
                value={guests.ladies}
                onChange={(e) => handleLadiesChange(e.target.value)}
              />
            </div>
          </div>
        )}
        {!customSplit && total > 0 && (
          <p className="text-xs text-muted-foreground mt-1">Split: {Math.ceil(total / 2)} gents / {Math.floor(total / 2)} ladies</p>
        )}
      </div>

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
