// Named colour tokens for org-customizable lead statuses. Classes are written
// out literally so Tailwind's JIT includes them. `header` = kanban column header,
// `badge` = the count chip on that header, `pill` = tinted table status pill,
// `dot` = a small swatch for pickers.
export type StatusColorClasses = {
  header: string;
  badge: string;
  pill: string;
  dot: string;
};

export const STATUS_COLORS: Record<string, StatusColorClasses> = {
  blue: { header: "bg-blue-500 text-white", badge: "bg-white/20 text-white", pill: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  amber: { header: "bg-amber-500 text-white", badge: "bg-white/20 text-white", pill: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  cyan: { header: "bg-cyan-500 text-white", badge: "bg-white/20 text-white", pill: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-500" },
  violet: { header: "bg-violet-500 text-white", badge: "bg-white/20 text-white", pill: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  green: { header: "bg-green-500 text-white", badge: "bg-white/20 text-white", pill: "bg-green-100 text-green-700", dot: "bg-green-500" },
  teal: { header: "bg-teal-500 text-white", badge: "bg-white/20 text-white", pill: "bg-teal-100 text-teal-700", dot: "bg-teal-500" },
  red: { header: "bg-red-500 text-white", badge: "bg-white/20 text-white", pill: "bg-red-100 text-red-700", dot: "bg-red-500" },
  pink: { header: "bg-pink-500 text-white", badge: "bg-white/20 text-white", pill: "bg-pink-100 text-pink-700", dot: "bg-pink-500" },
  indigo: { header: "bg-indigo-500 text-white", badge: "bg-white/20 text-white", pill: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500" },
  orange: { header: "bg-orange-500 text-white", badge: "bg-white/20 text-white", pill: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  gray: { header: "bg-gray-500 text-white", badge: "bg-white/20 text-white", pill: "bg-gray-100 text-gray-700", dot: "bg-gray-500" },
  slate: { header: "bg-slate-500 text-white", badge: "bg-white/20 text-white", pill: "bg-slate-100 text-slate-700", dot: "bg-slate-500" },
};

// Display order for colour pickers.
export const STATUS_COLOR_TOKENS = Object.keys(STATUS_COLORS);

export function statusColor(token?: string | null): StatusColorClasses {
  return STATUS_COLORS[token || ""] || STATUS_COLORS.slate;
}
