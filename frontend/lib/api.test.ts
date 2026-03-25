import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "./api";

// We test URL construction and parameter handling by mocking global.fetch.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockOk(data: unknown = { results: [], count: 0 }) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(""),
  });
}

/** Get the URL from the most recent fetch call */
function lastUrl(): string {
  const calls = mockFetch.mock.calls;
  return calls[calls.length - 1][0] as string;
}

beforeEach(() => {
  mockFetch.mockClear();
  mockOk();
});

describe("api.getLeadsPaginated", () => {
  it("sends no query string when filters are empty", async () => {
    await api.getLeadsPaginated();
    expect(lastUrl()).toMatch(/\/bookings\/leads\/$/);
  });

  it("includes search param in query string", async () => {
    await api.getLeadsPaginated({ search: "alice" });
    expect(lastUrl()).toContain("search=alice");
  });

  it("includes multiple filter params", async () => {
    await api.getLeadsPaginated({ status: "new", assigned_to: "5", search: "test" });
    const url = lastUrl();
    expect(url).toContain("status=new");
    expect(url).toContain("assigned_to=5");
    expect(url).toContain("search=test");
  });

  it("excludes empty string and null values from query string", async () => {
    await api.getLeadsPaginated({ status: "", search: "bob" });
    const url = lastUrl();
    expect(url).not.toContain("status=");
    expect(url).toContain("search=bob");
  });
});

describe("api.getLeadsKanban", () => {
  it("hits the kanban endpoint", async () => {
    await api.getLeadsKanban();
    expect(lastUrl()).toMatch(/\/bookings\/leads\/kanban\/$/);
  });

  it("passes search param to kanban endpoint", async () => {
    await api.getLeadsKanban({ search: "sunrise" });
    const url = lastUrl();
    expect(url).toContain("search=sunrise");
    expect(url).toContain("/kanban/");
  });
});

describe("api.getLeads (unpaginated)", () => {
  it("sends no query string with no filters", async () => {
    await api.getLeads();
    expect(lastUrl()).toMatch(/\/bookings\/leads\/$/);
  });
});

describe("fetchApi error handling", () => {
  it("throws sanitized error on 500", async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });
    await expect(api.getLeads()).rejects.toThrow("Server error (500)");
  });

  it("extracts detail from JSON error response", async () => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ detail: "Invalid filter" })),
    });
    await expect(api.getLeads()).rejects.toThrow("Invalid filter");
  });

  it("retries on 401 after successful refresh", async () => {
    mockFetch.mockClear();
    // First call: 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    // Refresh call: success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
    // Retry call: success with data
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([{ id: 1 }]),
    });

    const result = await api.getLeads();
    expect(result).toEqual([{ id: 1 }]);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
