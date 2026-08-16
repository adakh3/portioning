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
    // What the backend's 401 actually says; the api layer surfaces `detail`.
    login.mockRejectedValue(new Error("Invalid email or password."));
    render(<LoginPage />);
    fillAndSubmit();
    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
  });

  it("shows the lockout reason rather than a credentials error (REL-485)", async () => {
    // A locked-out account answers 429 with the reason. Rewriting that as
    // "invalid password" tells the user to keep retrying the thing that is
    // locking them out.
    login.mockRejectedValue(
      new Error("Too many failed sign-in attempts for this account. Try again later."),
    );
    render(<LoginPage />);
    fillAndSubmit();
    expect(await screen.findByText(/Too many failed sign-in attempts/)).toBeInTheDocument();
    expect(screen.queryByText("Invalid email or password.")).not.toBeInTheDocument();
  });

  it("falls back to the generic message when the failure has no detail", async () => {
    // e.g. the network dropped — there is nothing specific to tell them.
    login.mockRejectedValue(new Error("   "));
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
