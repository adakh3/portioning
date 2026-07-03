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

describe("api follow-up drafts", () => {
  function lastInit(): RequestInit {
    const calls = mockFetch.mock.calls;
    return (calls[calls.length - 1][1] || {}) as RequestInit;
  }

  it("queue defaults to pending and requests all rows", async () => {
    await api.getFollowUpDrafts();
    const url = lastUrl();
    expect(url).toContain("/bookings/followup-drafts/");
    expect(url).toContain("status=pending");
    expect(url).toContain("page_size=all");
  });

  it("queue accepts an explicit status", async () => {
    await api.getFollowUpDrafts("sent");
    expect(lastUrl()).toContain("status=sent");
  });

  it("lead-scoped list hits the nested route", async () => {
    await api.getLeadFollowUpDrafts(42);
    expect(lastUrl()).toContain("/bookings/leads/42/followup-drafts/");
  });

  it("count hits the count endpoint", async () => {
    mockOk({ pending: 3 });
    const res = await api.getFollowUpDraftCount();
    expect(lastUrl()).toMatch(/\/bookings\/followup-drafts\/count\/$/);
    expect(res.pending).toBe(3);
  });

  it("approve without edit posts an empty body", async () => {
    await api.approveFollowUpDraft(7);
    expect(lastUrl()).toContain("/followup-drafts/7/approve/");
    const init = lastInit();
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("approve with an edited body sends it", async () => {
    await api.approveFollowUpDraft(7, "Edited text");
    expect(JSON.parse(lastInit().body as string)).toEqual({ body: "Edited text" });
  });

  it("dismiss posts to the dismiss route", async () => {
    await api.dismissFollowUpDraft(9);
    expect(lastUrl()).toContain("/followup-drafts/9/dismiss/");
    expect(lastInit().method).toBe("POST");
  });

  it("bulk-approve with no ids sends an empty body", async () => {
    await api.bulkApproveFollowUpDrafts();
    expect(lastUrl()).toContain("/followup-drafts/bulk-approve/");
    expect(JSON.parse(lastInit().body as string)).toEqual({});
  });

  it("bulk-approve with ids sends them", async () => {
    await api.bulkApproveFollowUpDrafts([1, 2, 3]);
    expect(JSON.parse(lastInit().body as string)).toEqual({ ids: [1, 2, 3] });
  });
});
