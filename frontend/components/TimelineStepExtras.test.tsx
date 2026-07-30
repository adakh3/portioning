import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TimelineStepExtras, { offsetLabel } from "./TimelineStepExtras";
import { ChoiceOption } from "@/lib/api";

const step = (over: Partial<ChoiceOption> = {}): ChoiceOption => ({
  id: 1, value: "setup", label: "Setup", sort_order: 1, is_active: true,
  in_standard_day: true, standard_day_offset_minutes: -150, ...over,
});

describe("offsetLabel", () => {
  it("reads as a span either side of the meal", () => {
    expect(offsetLabel(-150)).toBe("2h30 before");
    expect(offsetLabel(-45)).toBe("45m before");
    expect(offsetLabel(0)).toBe("at meal");
    expect(offsetLabel(90)).toBe("1h30 after");
    expect(offsetLabel(240)).toBe("4h after");
  });
});

describe("TimelineStepExtras", () => {
  it("shows the step's current placement in the standard day", () => {
    render(<TimelineStepExtras option={step()} patch={() => {}} />);
    expect(screen.getByLabelText("Include Setup in the standard day")).toBeChecked();
    expect(screen.getByLabelText("Setup offset from meal service")).toHaveValue("-150");
  });

  it("retimes the step", () => {
    const patch = vi.fn();
    render(<TimelineStepExtras option={step()} patch={patch} />);
    fireEvent.change(screen.getByLabelText("Setup offset from meal service"), { target: { value: "-45" } });
    expect(patch).toHaveBeenCalledWith({ standard_day_offset_minutes: -45 });
  });

  it("drops a step out of the standard day without deleting it", () => {
    const patch = vi.fn();
    render(<TimelineStepExtras option={step()} patch={patch} />);
    fireEvent.click(screen.getByLabelText("Include Setup in the standard day"));
    expect(patch).toHaveBeenCalledWith({ in_standard_day: false });
  });

  it("greys out the offset for a step that isn't in the standard day", () => {
    render(<TimelineStepExtras option={step({ in_standard_day: false })} patch={() => {}} />);
    expect(screen.getByLabelText("Setup offset from meal service")).toBeDisabled();
  });

  it("gives a step joining the standard day somewhere to land", () => {
    // Without an offset the row is unplaceable and the prefill would skip it,
    // so ticking the box has to supply one.
    const patch = vi.fn();
    render(
      <TimelineStepExtras
        option={step({ in_standard_day: false, standard_day_offset_minutes: null })}
        patch={patch}
      />,
    );
    fireEvent.click(screen.getByLabelText("Include Setup in the standard day"));
    expect(patch).toHaveBeenCalledWith({ in_standard_day: true, standard_day_offset_minutes: 0 });
  });

  it("keeps an offset that isn't on the 15-minute grid", () => {
    // Regression: the API takes any integer. With no matching option the select
    // silently showed the FIRST one (-6h) and would have saved that on the next
    // edit — a step quietly moved by hours.
    render(<TimelineStepExtras option={step({ standard_day_offset_minutes: -100 })} patch={() => {}} />);
    const select = screen.getByLabelText("Setup offset from meal service") as HTMLSelectElement;
    expect(select.value).toBe("-100");
    expect(screen.getByText("1h40 before")).toBeInTheDocument();
  });
});
