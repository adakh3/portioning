/** A small circular initials avatar for a user. Tinted background + darker text
 * (matching the app's pill style), with a deterministic colour per name so the
 * same person is always the same colour. Renders a dashed placeholder when there's
 * no name (unassigned). */

const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, size = "md", className = "" }: { name?: string | null; size?: "sm" | "md"; className?: string }) {
  const sizeCls = size === "sm" ? "h-5 w-5 text-[9px]" : "h-7 w-7 text-xs";
  const clean = (name || "").trim();
  if (!clean) {
    return (
      <span
        title="Unassigned"
        className={`inline-flex ${sizeCls} shrink-0 items-center justify-center rounded-full leading-none border border-dashed border-input text-muted-foreground ${className}`}
      >
        –
      </span>
    );
  }
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  const colour = PALETTE[hash % PALETTE.length];
  return (
    <span
      title={clean}
      className={`inline-flex ${sizeCls} shrink-0 items-center justify-center rounded-full leading-none font-semibold ${colour} ${className}`}
    >
      {initialsOf(clean) || "?"}
    </span>
  );
}
