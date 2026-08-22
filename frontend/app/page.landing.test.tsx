import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Logged-out state: the root page must render the marketing landing, not the
// dashboard (REL-482 AC1). The signed-in dashboard path is covered by the
// existing page.followup-stats tests.
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("@/lib/api", () => ({ api: {} }));
vi.mock("@/lib/hooks", () => ({}));
vi.mock("@/lib/orgLocale", () => ({ useOrgLocale: () => ({ symbol: "$" }) }));
vi.mock("@/components/MyTargetsPanel", () => ({ default: () => null }));
vi.mock("next/image", () => ({
  default: ({ fill, priority, ...props }: Record<string, unknown>) => <img alt="" {...props} />,
}));

import HomePage from "./page";

describe("Root page for logged-out visitors (REL-482 AC1)", () => {
  it("renders the landing page instead of the dashboard", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "The AI sales agent for catering.",
    );
    expect(screen.queryByText("Overview of your catering operations")).not.toBeInTheDocument();
  });
});
