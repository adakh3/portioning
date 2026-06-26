import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import CommissionRedirect from "./page";

describe("/commission (legacy route)", () => {
  it("redirects to the dashboard, where My Targets now lives", () => {
    render(<CommissionRedirect />);
    expect(replace).toHaveBeenCalledWith("/");
  });
});
