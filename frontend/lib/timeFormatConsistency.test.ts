import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every surface must show times in the org's 12h/24h preference.
 *
 * `formatDateTime(value, dateFormat, timeFormat = "24h")` defaults its third
 * argument, so a caller who omits it silently renders 24-hour times to a
 * 12-hour org. That is exactly what happened: lead timestamps printed "18:00"
 * while the same org's bookings printed "6:00 PM".
 *
 * The fix is `useFormatDateTime()`, which binds both preferences and takes no
 * format arguments at all. This test stops the two-argument call creeping back.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("time formatting honours the org's 12h/24h preference", () => {
  it("no component calls formatDateTime without a time format", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles("app"), ...sourceFiles("components")]) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        // A two-argument call — value + dateFormat — silently defaults to 24h.
        if (/formatDateTime\([^)]*,[^),]*\)/.test(line) && !/timeFormat/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Use useFormatDateTime() instead — it binds the org's date AND time format:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
