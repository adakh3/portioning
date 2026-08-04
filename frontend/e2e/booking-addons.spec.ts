import { test, expect } from "@playwright/test";
import { addAddOn, login, pickCustomer } from "./helpers";

/**
 * REL-454 AC14 — the add-ons card in a REAL browser, end to end.
 *
 * The vitest suite mocks the API, so it proves the wiring and nothing about
 * persistence: whether a variant chip's line, a hand-typed custom line, a stepper
 * quantity and an overridden price all come back after a save and a hard reload.
 * That is the class the mocked tests are blind to, so it lives here.
 *
 * Uses seed_demo's catalogue: "Soft Drinks" (variants 1.5L $150 / Tins $80).
 */
test.describe("Add-on lines survive a save and a reload", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("a variant line, a custom line, a quantity and a price all persist", async ({ page }) => {
    await page.goto("/quotes/new");
    await pickCustomer(page);
    await page.getByLabel("Guest Count").fill("100");
    await page.getByRole("button", { name: "Create Quote" }).click();
    await page.waitForURL(/\/quotes\/\d+$/, { timeout: 15_000 });
    const quoteUrl = page.url();

    await page.getByRole("button", { name: "Edit Quote" }).click();

    // Each row names itself in its group label, so its own controls are short.
    const row = (i: number) => page.getByTestId(`addon-line-${i}`);

    // 1) A variant chip → a line named after product AND variant, qty 12.
    await addAddOn(page, "Soft Drinks · 1.5L", "Soft Drinks");
    await row(0).getByLabel("Quantity", { exact: true }).fill("12");
    await expect(row(0)).toContainText("$1,800.00");

    // 2) A custom line the catalogue has never heard of, priced by hand. It opens
    //    straight into its name field.
    await page.getByRole("button", { name: "Custom item" }).click();
    await row(1).getByLabel("Name", { exact: true }).fill("Coat check");
    await row(1).getByLabel("Name", { exact: true }).press("Enter");
    await row(1).getByRole("button", { name: "Edit price, unit and category" }).click();
    await row(1).getByLabel("Unit price", { exact: true }).fill("100");
    await expect(row(1)).toContainText("$100.00");

    // 3) The card's own subtotal — and the identical number in the totals card,
    //    which is the parity the two are supposed to keep (AC6).
    await expect(page.getByText("Add-ons subtotal").locator("..")).toContainText("$1,900.00");
    await expect(page.getByText("Add-on items").locator("..")).toContainText("$1,900.00");

    await page.getByRole("button", { name: "Save Quote" }).click();

    // Saved and stored: view mode reads the backend's own numbers, so this is the
    // server agreeing with the preview, not the preview agreeing with itself.
    await expect(page.getByText("Soft Drinks · 1.5L")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Coat check")).toBeVisible();
    await expect(page.getByText(/Subtotal:\s*\$1,900\.00/)).toBeVisible();

    // 4) Hard reload — nothing in memory survives this.
    await page.goto(quoteUrl);
    await expect(page.getByText("Soft Drinks · 1.5L")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Coat check")).toBeVisible();
    await expect(page.getByText(/Subtotal:\s*\$1,900\.00/)).toBeVisible();

    // 5) And back in the editor the lines are whole again — name, quantity, price,
    //    line total — not just present in a read-only table. The API hands quantities
    //    and prices back as decimals ("12.00"), which is what the row hydrates from.
    await page.getByRole("button", { name: "Edit Quote" }).click();
    await expect(row(0).getByLabel("Quantity", { exact: true })).toHaveValue("12.00");
    await expect(row(0).getByRole("button", { name: "Edit price, unit and category" }))
      .toContainText("$150.00 each");
    await expect(row(0)).toContainText("$1,800.00");
    await expect(row(1).getByRole("button", { name: "Edit name" })).toContainText("Coat check");
    await expect(page.getByText("Add-ons subtotal").locator("..")).toContainText("$1,900.00");

    // 6) The picker knows the 1.5L is spoken for; its sibling is still free.
    await page.getByRole("button", { name: "+ Add item" }).click();
    const picker = page.getByTestId("addon-picker");
    await picker.getByLabel("Search add-ons").fill("Soft Drinks");
    await expect(picker.getByRole("button", { name: "Soft Drinks · 1.5L — already on quote" })).toBeDisabled();
    await expect(picker.getByRole("button", { name: "Add Soft Drinks · Tins", exact: true })).toBeEnabled();
  });
});
