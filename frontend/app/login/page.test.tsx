import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const login = vi.fn();
let returnTo: string | null = null;
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ login }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "returnTo" ? returnTo : null) }),
}));
vi.mock("@/lib/api", () => ({ api: { createDemoRequest: vi.fn() } }));

import LoginPage from "./page";

function fillAndSubmit(email = "owner@demo.test", password = "Owner123!") {
  fireEvent.change(document.getElementById("email")!, { target: { value: email } });
  fireEvent.change(document.getElementById("password")!, { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("Login page (REL-482)", () => {
  beforeEach(() => {
    login.mockReset();
    returnTo = null;
  });

  it("signs in with the entered credentials (AC12)", async () => {
    login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("owner@demo.test", "Owner123!", undefined),
    );
  });

  it("passes returnTo through to login (AC12)", async () => {
    returnTo = "/quotes";
    login.mockResolvedValue(undefined);
    render(<LoginPage />);
    fillAndSubmit();
    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("owner@demo.test", "Owner123!", "/quotes"),
    );
  });

  it("shows the inline error on bad credentials (AC13)", async () => {
    login.mockRejectedValue(new Error("bad"));
    render(<LoginPage />);
    fillAndSubmit();
    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
  });

  it("has no forgot-password link (AC14)", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
  });

  it("opens the Book-a-Demo modal (AC15)", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Book a demo" }));
    expect(screen.getByRole("dialog", { name: "Book a demo" })).toBeInTheDocument();
  });
});
