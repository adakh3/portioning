import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

// Which 401s are allowed to trigger a token refresh (REL-477).
//
// The rule used to be "no path under /auth/", which quietly swept in /auth/me/
// — the very first call the app makes. An expired access token therefore logged
// the user straight out instead of refreshing, most visibly when returning from
// the mailbox OAuth consent screen.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function res(status: number, data: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

/** The paths hit, in order, so we can assert whether a refresh was attempted. */
function paths(): string[] {
  return mockFetch.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("a 401 that should refresh", () => {
  it("renews the token and retries /auth/me/ instead of logging the user out", async () => {
    mockFetch
      .mockResolvedValueOnce(res(401))                              // stale access token
      .mockResolvedValueOnce(res(200, { ok: true }))                // refresh succeeds
      .mockResolvedValueOnce(res(200, { id: 1, email: "a@b.com" })); // retry

    const user = await api.getMe();

    expect(user).toEqual({ id: 1, email: "a@b.com" });
    expect(paths()).toHaveLength(3);
    expect(paths()[1]).toContain("/auth/refresh/");
    expect(paths()[2]).toContain("/auth/me/");
  });

  it("does the same for the other authenticated /auth/ reads", async () => {
    mockFetch
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { ok: true }))
      .mockResolvedValueOnce(res(200, [{ id: 1, name: "Org" }]));

    await api.getOrganisations();

    expect(paths()[1]).toContain("/auth/refresh/");
  });

  it("still refreshes on ordinary non-auth endpoints", async () => {
    mockFetch
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { ok: true }))
      .mockResolvedValueOnce(res(200, { results: [], count: 0 }));

    await api.getLeadsPaginated();

    expect(paths()[1]).toContain("/auth/refresh/");
  });

  it("surfaces the failure when the refresh token is genuinely dead", async () => {
    mockFetch
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(401)); // refresh rejected — really logged out

    await expect(api.getMe()).rejects.toThrow(/unauthorized/i);
    expect(paths()).toHaveLength(2);
  });
});

describe("a 401 that must not refresh", () => {
  it("does not recurse when the refresh call itself is rejected", async () => {
    // One failed refresh, not an endless chain of them.
    mockFetch
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(401));

    await expect(api.getMe()).rejects.toThrow();
    expect(paths().filter((p) => p.includes("/auth/refresh/"))).toHaveLength(1);
  });

  it("does not retry a rejected login, which would mask a wrong password", async () => {
    mockFetch.mockResolvedValueOnce(res(401, { detail: "No active account found" }));

    await expect(api.login("a@b.com", "wrong")).rejects.toThrow();
    expect(paths()).toHaveLength(1);
    expect(paths()[0]).toContain("/auth/login/");
  });
});
