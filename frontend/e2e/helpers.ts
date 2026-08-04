import { Page, expect } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL || "owner@demo.test";
const PASSWORD = process.env.E2E_PASSWORD || "Owner123!";

/** Log in through the real login form and wait until we've left /login. */
export async function login(page: Page) {
  await page.goto("/login");
  await page.locator("input[type=email]").fill(EMAIL);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  // Sanity: a logged-in shell renders a nav, not the sign-in button.
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
}

/**
 * Choose from a SearchableSelect (Customer, Business, Link to Lead).
 *
 * These are comboboxes built from a button + a filtered list, not native
 * <select>s, so `selectOption` doesn't apply: open it, type enough to narrow the
 * list, then click the row. Typing matters — it's how the control behaves for a
 * real user with hundreds of rows, and it keeps the click off a stale index.
 */
export async function pickFromSearchable(page: Page, label: string, optionName: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByLabel(`Search ${label.toLowerCase()}`).fill(optionName);
  await page.getByRole("option", { name: optionName }).first().click();
  await expect(page.getByRole("button", { name: label, exact: true })).toContainText(optionName);
}

/** The customer every booking spec needs before it can save. */
export const pickCustomer = (page: Page, name = "Aisha Khan") =>
  pickFromSearchable(page, "Customer", name);

/**
 * Add a catalogue add-on through the searchable picker (REL-454).
 *
 * `label` is the row/chip as it reads in the picker ("Buffet Station",
 * "Soft Drinks · 1.5L"); `search` is what to type to find it, which for a variant
 * chip is the product, not the chip.
 */
export async function addAddOn(page: Page, label: string, search = label) {
  await page.getByRole("button", { name: "+ Add item" }).click();
  const picker = page.getByTestId("addon-picker");
  await picker.getByLabel("Search add-ons").fill(search);
  await picker.getByRole("button", { name: `Add ${label}`, exact: true }).click();
  await picker.getByRole("button", { name: "Cancel" }).click();
}
