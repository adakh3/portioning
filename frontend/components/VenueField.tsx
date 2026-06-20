"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useVenues } from "@/lib/hooks";

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Venue input. Most events are off-premise at a free-text address (the
 * customer's home); some are at a saved venue from the list (which can be added
 * on the fly). `venue` is the FK id (string, "" = none); `address` is freeform. */
export default function VenueField({
  venue,
  address,
  onVenue,
  onAddress,
}: {
  venue: string;
  address: string;
  onVenue: (id: string) => void;
  onAddress: (text: string) => void;
}) {
  const { data: venues = [], mutate } = useVenues();
  const [mode, setMode] = useState<"address" | "venue">(venue ? "venue" : "address");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", city: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function chooseMode(m: "address" | "venue") {
    setMode(m);
    if (m === "address") onVenue(""); // an address booking has no saved venue
  }

  async function createVenue() {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const v = await api.createVenue({ name: form.name.trim(), city: form.city.trim() });
      await mutate();
      onVenue(String(v.id));
      setCreating(false);
      setForm({ name: "", city: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create venue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex gap-4 mb-2 text-sm">
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="venueMode" checked={mode === "address"} onChange={() => chooseMode("address")} />
          Address (off-premise / home)
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="venueMode" checked={mode === "venue"} onChange={() => chooseMode("venue")} />
          Saved venue
        </label>
      </div>

      {mode === "address" ? (
        <textarea
          value={address}
          onChange={(e) => onAddress(e.target.value)}
          rows={2}
          maxLength={300}
          placeholder="e.g. 42 Oak Lane, Manchester — or the customer's home"
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      ) : creating ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <input autoFocus type="text" placeholder="Venue name *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          <input type="text" placeholder="City" value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputClass} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={createVenue} disabled={saving}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? "Adding…" : "Add venue"}
            </button>
            <button type="button" onClick={() => { setCreating(false); setError(""); }}
              className="rounded border border-input px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <select value={venue} onChange={(e) => onVenue(e.target.value)} className={selectClass}>
            <option value="">-- Select venue --</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}{v.city ? ` — ${v.city}` : ""}</option>)}
          </select>
          <button type="button" onClick={() => setCreating(true)} className="text-xs text-primary hover:underline">+ New venue</button>
          <input type="text" value={address} onChange={(e) => onAddress(e.target.value)}
            placeholder="Address notes (optional)" className={inputClass} />
        </div>
      )}
    </div>
  );
}
