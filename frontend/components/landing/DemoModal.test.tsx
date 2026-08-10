import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { createDemoRequest } = vi.hoisted(() => ({ createDemoRequest: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { createDemoRequest } }));

import DemoModal from "./DemoModal";

describe("DemoModal (REL-482)", () => {
  // Braces matter: mockReset() returns the mock, and a function returned from
  // beforeEach is treated as a teardown callback — vitest would then CALL the
  // mock as cleanup, leaking an unhandled rejection in rejected-mock tests.
  beforeEach(() => {
    createDemoRequest.mockReset();
  });

  function fill(name: string, email: string, events = "") {
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: email } });
    if (events) fireEvent.change(screen.getByLabelText("Events per month"), { target: { value: events } });
  }

  it("renders nothing when closed", () => {
    render(<DemoModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the request and shows the success state (AC8)", async () => {
    createDemoRequest.mockResolvedValue({});
    render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "jane@kitchen.com", "12");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));

    expect(await screen.findByText(/Request received/)).toBeInTheDocument();
    expect(createDemoRequest).toHaveBeenCalledWith({
      name: "Jane Doe",
      email: "jane@kitchen.com",
      events_per_month: "12",
      website: "",
    });
  });

  it("rejects a missing name without calling the API (AC9)", () => {
    render(<DemoModal open onClose={() => {}} />);
    fill("", "jane@kitchen.com");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));
    expect(screen.getByText(/valid work email/)).toBeInTheDocument();
    expect(createDemoRequest).not.toHaveBeenCalled();
  });

  it("rejects an invalid email without calling the API (AC9)", () => {
    render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "not-an-email");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));
    expect(screen.getByText(/valid work email/)).toBeInTheDocument();
    expect(createDemoRequest).not.toHaveBeenCalled();
  });

  it("surfaces an API failure as an inline error", async () => {
    const boom = new Error("boom");
    createDemoRequest.mockImplementation(() => Promise.reject(boom));
    render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "jane@kitchen.com");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));
    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    });
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<DemoModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
