import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import PrivacyPolicyPage from "./page";

// Public policy page linked from Meta's app config. These assertions pin the
// content Meta reviewers (and users) expect to find: what data is handled, the
// Meta-specific handling, and a working data-deletion path.
describe("Privacy Policy page", () => {
  it("renders the policy with the sections Meta review looks for", () => {
    render(<PrivacyPolicyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Meta Platform data" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /data deletion/i })).toBeTruthy();
    // Tokens-encrypted claim + no-advertising claim are the load-bearing ones.
    expect(screen.getByText(/encrypted at rest/i)).toBeTruthy();
    // A reachable deletion contact.
    const mailto = screen.getAllByRole("link", { name: "privacy@relogue.com" })[0];
    expect(mailto.getAttribute("href")).toBe("mailto:privacy@relogue.com");
  });
});
