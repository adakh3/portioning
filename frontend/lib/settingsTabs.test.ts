import { settingsTabsFor, SETTINGS_TABS, BILLING_TAB } from "./settingsTabs";

describe("settingsTabsFor", () => {
  it("gives owners the Billing tab, appended last", () => {
    const tabs = settingsTabsFor(true);
    expect(tabs).toHaveLength(SETTINGS_TABS.length + 1);
    expect(tabs[tabs.length - 1]).toEqual(BILLING_TAB);
    expect(tabs.some((t) => t.id === "billing")).toBe(true);
  });

  it("hides the Billing tab from non-owners (e.g. admins)", () => {
    const tabs = settingsTabsFor(false);
    expect(tabs).toHaveLength(SETTINGS_TABS.length);
    expect(tabs.some((t) => t.id === "billing")).toBe(false);
  });

  it("keeps the base tabs unchanged in order for everyone", () => {
    const ids = settingsTabsFor(false).map((t) => t.id);
    expect(ids).toEqual([
      "general",
      "pipeline",
      "options",
      "branding",
      "commission",
      "integrations",
    ]);
  });
});
