// Settings page tab list. Kept here (not inline in the page) so the
// role-based visibility of the owner-only Billing tab is unit-testable.

export interface SettingsTab {
  id: string;
  label: string;
}

export const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", label: "General" },
  { id: "pipeline", label: "Lead Pipeline" },
  { id: "options", label: "Options" },
  { id: "branding", label: "Product Lines" },
  { id: "commission", label: "Commission" },
  { id: "integrations", label: "Integrations" },
];

// Billing is owner-only (subscription management for the whole org). Admins can
// reach Settings but not this tab — mirrors the prior owner-only nav link.
export const BILLING_TAB: SettingsTab = { id: "billing", label: "Billing" };

/** Tabs visible to a user; owners/superusers also get the Billing tab. */
export function settingsTabsFor(isOwner: boolean): SettingsTab[] {
  return isOwner ? [...SETTINGS_TABS, BILLING_TAB] : SETTINGS_TABS;
}
