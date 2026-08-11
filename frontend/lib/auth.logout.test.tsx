import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import useSWR from "swr";

/**
 * Signing out must leave nothing behind in the SWR cache.
 *
 * Sign-out is a client-side navigation, so the page never reloads and the cache
 * outlives the session unless something clears it. The next person to sign in on
 * the same browser would otherwise read the previous user's org data — their
 * settings, customers, leads — until each query happened to refetch on its own.
 *
 * The assertion is on the cache rather than on anything rendered, because a full
 * page load wipes the cache anyway: a test that navigates can't see this bug.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => ({ get: () => null }),
}));

const logoutApi = vi.fn(async () => {});
vi.mock("./api", () => ({
  api: {
    logout: () => logoutApi(),
    getMe: vi.fn(async () => { throw new Error("not signed in"); }),
    login: vi.fn(),
    switchOrg: vi.fn(),
  },
}));

import { AuthProvider, useAuth } from "./auth";

/** Reads a cached query and exposes a logout button, like the real app. */
function Probe() {
  const { logout } = useAuth();
  const { data } = useSWR("settings", async () => "$");
  return (
    <>
      <span data-testid="symbol">{data ?? "—"}</span>
      <button onClick={() => logout()}>Sign out</button>
    </>
  );
}

describe("signing out", () => {
  beforeEach(() => {
    push.mockClear();
    logoutApi.mockClear();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
  });

  it("empties the cache so the next session can't read it", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    // The previous user's data is cached.
    await waitFor(() => expect(screen.getByTestId("symbol")).toHaveTextContent("$"));

    await act(async () => {
      screen.getByRole("button", { name: "Sign out" }).click();
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    // Nothing of theirs is left for whoever signs in next.
    expect(screen.getByTestId("symbol")).toHaveTextContent("—");
  });
});
