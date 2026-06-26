import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let role = "salesperson";

vi.mock("next/navigation", () => ({ usePathname: () => "/commission" }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role } }) }));

import Sidebar from "./Sidebar";

beforeEach(() => { role = "salesperson"; });

describe("Sidebar role gating", () => {
  it("hides the Admin department from a salesperson", () => {
    role = "salesperson";
    render(<Sidebar />);
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows the Admin department to an owner", () => {
    role = "owner";
    render(<Sidebar />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });
});
