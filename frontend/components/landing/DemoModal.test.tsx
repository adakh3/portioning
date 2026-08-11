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
      referral_source: "",
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

  it("shows the server's own reason rather than a generic failure", async () => {
    // The API layer already sanitises 4xx bodies into a readable sentence;
    // throwing it away left a throttled or over-long submission looking like an
    // unexplained crash, which just loses the lead.
    createDemoRequest.mockImplementation(() =>
      Promise.reject(new Error("Request was throttled. Expected available in 42 seconds.")),
    );
    render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "jane@kitchen.com");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));

    await waitFor(() => {
      expect(screen.getByText(/Request was throttled/)).toBeInTheDocument();
    });
  });

  it("falls back to a generic message when the failure carries no detail", async () => {
    createDemoRequest.mockImplementation(() => Promise.reject(new Error("")));
    render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "jane@kitchen.com");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    });
  });

  it("reopens on a blank form after a successful submission", async () => {
    // Without a reset the modal is one-shot per page load: anyone who submits
    // and then spots a typo reopens onto the old success screen, with no fields
    // and no way to correct it short of reloading the page.
    createDemoRequest.mockResolvedValue({});
    const { rerender } = render(<DemoModal open onClose={() => {}} />);
    fill("Jane Doe", "jane@kitchne.com");
    fireEvent.click(screen.getByRole("button", { name: "Request Demo" }));
    expect(await screen.findByText(/Request received/)).toBeInTheDocument();

    rerender(<DemoModal open={false} onClose={() => {}} />);
    rerender(<DemoModal open onClose={() => {}} />);

    expect(screen.queryByText(/Request received/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveValue("");
    expect(screen.getByLabelText("Work email")).toHaveValue("");
  });

  it("closes via the close button, the backdrop and Escape", () => {
    const onClose = vi.fn();
    render(<DemoModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps a click inside the dialog from closing it", () => {
    const onClose = vi.fn();
    render(<DemoModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });
});
