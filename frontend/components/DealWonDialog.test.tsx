import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("react-countup", () => ({
  default: ({ end, prefix = "" }: { end: number; prefix?: string }) =>
    `${prefix}${Number(end).toLocaleString("en-US")}`,
}));

import DealWonDialog from "./DealWonDialog";

describe("DealWonDialog", () => {
  it("celebrates the booking when open", () => {
    render(
      <DealWonDialog open onClose={() => {}} eventName="Khan Wedding" repName="Demo Rep"
        revenue="600000" currencySymbol="£" />,
    );
    expect(screen.getByText("Khan Wedding")).toBeInTheDocument();
    expect(screen.getByText("Demo Rep")).toBeInTheDocument();
    expect(screen.getByText("£600,000")).toBeInTheDocument();
    expect(screen.getByText("Claim & continue")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<DealWonDialog open={false} onClose={() => {}} eventName="Khan Wedding" revenue="1" />);
    expect(screen.queryByText("Claim & continue")).not.toBeInTheDocument();
  });
});
