import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * REL-444 — the BEO download, and the header that carries its button.
 *
 * Two things here can only be proven in a real browser. A file download is one:
 * jsdom has no download plumbing, so the mocked suite can assert we *called* the
 * API and nothing about whether a PDF actually lands. Layout is the other — jsdom
 * computes no geometry at all, which is how the event header shipped with its
 * product dropdown rendering UNDERNEATH the action buttons: every unit test passed
 * because none of them could see where anything was.
 */
test.describe("Event BEO", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /** Open the first saved event. The list navigates on a row `onClick`, not an
      `<a href>`, so this clicks the row a user would click. */
  async function openAnEvent(page: import("@playwright/test").Page) {
    await page.goto("/events");
    const row = page.locator("table tbody tr").first();
    await expect(row, "no saved event on the list — seed_demo not run?")
      .toBeVisible({ timeout: 15_000 });
    await row.click();
    await page.waitForURL(/\/events\/\d+$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Download PDF" })).toBeVisible({ timeout: 15_000 });
  }

  test("the BEO button downloads a PDF", async ({ page }) => {
    await openAnEvent(page);

    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await page.getByRole("button", { name: "BEO", exact: true }).click();
    const download = await downloadPromise;

    // Revision-stamped, which only works because the server's Content-Disposition
    // is readable cross-origin (CORS_EXPOSE_HEADERS). A blob URL carries no headers,
    // so if that ever regresses this silently falls back to a bare "BEO-8.pdf" and
    // every revision overwrites the last on disk — invisible to any mocked test.
    expect(download.suggestedFilename()).toMatch(/^BEO-\d+-Rev\d+\.pdf$/);
    // Prove it's a real PDF, not an error page the browser happily saved.
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path!).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("the header controls never overlap each other", async ({ page }) => {
    await openAnEvent(page);

    // Every control in the header card, buttons and dropdowns alike. The bug was
    // the left group overflowing its container and rendering beneath the button
    // group; anything that re-introduces it puts two boxes in the same place.
    const boxes = await page.evaluate(() => {
      const pdf = [...document.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Download PDF");
      const card = pdf?.closest("div.flex.flex-wrap") ?? pdf?.parentElement?.parentElement;
      const controls = [...(card?.querySelectorAll("button, select") ?? [])];
      return controls.map((el) => {
        const r = el.getBoundingClientRect();
        return { label: (el.textContent || (el as HTMLSelectElement).ariaLabel || "?").trim().slice(0, 24),
                 left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }).filter((b) => b.right > b.left && b.bottom > b.top);
    });

    expect(boxes.length).toBeGreaterThan(2); // the header really did render
    const collisions: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlaps = a.right > b.left && b.right > a.left
                      && a.bottom > b.top && b.bottom > a.top;
        if (overlaps) collisions.push(`${a.label} ↔ ${b.label}`);
      }
    }
    expect(collisions, `header controls overlap: ${collisions.join(", ")}`).toEqual([]);
  });
});
