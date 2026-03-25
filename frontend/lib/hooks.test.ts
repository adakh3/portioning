import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { SWRConfig } from "swr";
import { useLeadsPaginated, useKanbanData } from "./hooks";

// Mock the API module
vi.mock("./api", () => ({
  api: {
    getLeadsPaginated: vi.fn().mockResolvedValue({ results: [], count: 0 }),
    getLeadsKanban: vi.fn().mockResolvedValue({ columns: {} }),
    getSiteSettings: vi.fn().mockResolvedValue({ date_format: "DD/MM/YYYY" }),
  },
}));

import { api } from "./api";

// SWR wrapper that prevents cache leaking between tests
function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    children,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLeadsPaginated", () => {
  it("calls api.getLeadsPaginated with filters", async () => {
    const filters = { status: "new", search: "alice" };
    const { result } = renderHook(() => useLeadsPaginated(filters), { wrapper });

    await waitFor(() => {
      expect(api.getLeadsPaginated).toHaveBeenCalledWith(filters);
    });
  });

  it("does not fetch when paused", () => {
    renderHook(() => useLeadsPaginated({ status: "new" }, true), { wrapper });
    expect(api.getLeadsPaginated).not.toHaveBeenCalled();
  });

  it("includes search in SWR cache key", async () => {
    const filters1 = { search: "alice" };
    const filters2 = { search: "bob" };

    const { rerender } = renderHook(
      ({ f }) => useLeadsPaginated(f),
      { wrapper, initialProps: { f: filters1 } },
    );

    await waitFor(() => {
      expect(api.getLeadsPaginated).toHaveBeenCalledWith(filters1);
    });

    rerender({ f: filters2 });

    await waitFor(() => {
      expect(api.getLeadsPaginated).toHaveBeenCalledWith(filters2);
    });
  });
});

describe("useKanbanData", () => {
  it("calls api.getLeadsKanban with filters", async () => {
    const filters = { search: "wedding" };
    renderHook(() => useKanbanData(filters), { wrapper });

    await waitFor(() => {
      expect(api.getLeadsKanban).toHaveBeenCalledWith(filters);
    });
  });

  it("does not fetch when paused", () => {
    renderHook(() => useKanbanData({ search: "test" }, true), { wrapper });
    expect(api.getLeadsKanban).not.toHaveBeenCalled();
  });
});
