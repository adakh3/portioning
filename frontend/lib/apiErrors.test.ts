import { describe, it, expect } from "vitest";
import { collectErrorMessages } from "./api";

describe("collectErrorMessages — flatten DRF validation errors", () => {
  it("flattens nested line_items field errors into a readable sentence", () => {
    const msgs = collectErrorMessages({
      line_items: [{ unit_price: ["A valid number is required."] }],
    });
    const joined = msgs.join(" ");
    expect(joined).toContain("unit price");
    expect(joined).toContain("A valid number is required.");
  });

  it("handles flat field errors", () => {
    expect(collectErrorMessages({ contact_phone: ["This field is required."] }))
      .toEqual(["contact phone: This field is required."]);
  });

  it("handles non_field_errors / plain string arrays", () => {
    expect(collectErrorMessages(["Something went wrong."]))
      .toEqual(["Something went wrong."]);
  });
});
