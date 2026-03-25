import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders children", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies default variant classes", () => {
    render(<Badge>Default</Badge>);
    const el = screen.getByText("Default");
    expect(el.className).toContain("bg-primary");
  });

  it("applies destructive variant classes", () => {
    render(<Badge variant="destructive">Error</Badge>);
    const el = screen.getByText("Error");
    expect(el.className).toContain("bg-destructive");
  });

  it("applies outline variant classes", () => {
    render(<Badge variant="outline">Outline</Badge>);
    const el = screen.getByText("Outline");
    expect(el.className).toContain("text-foreground");
  });

  it("merges custom className", () => {
    render(<Badge className="mt-2">Custom</Badge>);
    const el = screen.getByText("Custom");
    expect(el.className).toContain("mt-2");
  });
});
