/**
 * Guard: no hardcoded UK currency/tax literals in app source.
 *
 * A one-time sweep removed every `£` / "GBP" / "VAT" fallback in favour of
 * `useOrgLocale()`. This test greps `app/ components/ lib/` for those literals so
 * the fix is permanent — a reintroduced `|| "£"` fails CI instead of shipping a
 * pound sign to a US org. Test fixtures and the provider itself are exempt.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // frontend/
const ROOTS = ["app", "components", "lib"];

// Files allowed to name these literals (the provider owns the neutral fallbacks;
// this guard file names them in its own assertions).
const ALLOW = new Set<string>([
  join("lib", "orgLocale.tsx"),
]);

const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "£ (pound sign)", re: /£/ },
  { label: 'a "GBP" literal', re: /["']GBP["']/ },
  { label: 'a "VAT" literal', re: /["']VAT["']/ },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "e2e", "__tests__"].includes(entry)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));

describe("locale guard", () => {
  for (const { label, re } of FORBIDDEN) {
    it(`has no ${label} outside the locale provider`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const rel = file.slice(ROOT.length + 1);
        if (ALLOW.has(rel)) continue;
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (re.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(
        offenders,
        `Hardcoded locale literal found — use useOrgLocale() instead:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});
