import { formatPercent } from "./utils";

// The screen must show the rate the customer is actually charged. Every totals
// card rounded the percentage to a whole number (`.toFixed(0)`), so an 8.5%
// sales tax read "9%" on screen while the PDF read "8%" (Decimal half-even) and
// the money — correct in both — was 8.5%. US rates are routinely fractional.
describe("formatPercent", () => {
  it("keeps a fractional rate", () => {
    expect(formatPercent(8.5)).toBe("8.5");
    expect(formatPercent(7.25)).toBe("7.25");
  });

  it("shows a whole rate without trailing zeros", () => {
    expect(formatPercent(20)).toBe("20");
    expect(formatPercent("20.00")).toBe("20");
    expect(formatPercent(0)).toBe("0");
  });

  it("accepts the decimal-fraction scaling the pages do", () => {
    expect(formatPercent(0.085 * 100)).toBe("8.5");
    expect(formatPercent(0.0725 * 100)).toBe("7.25");
  });

  it("is not NaN for junk", () => {
    expect(formatPercent("")).toBe("0");
    expect(formatPercent("abc")).toBe("0");
  });

  it("agrees with the backend PDF helper on the same inputs", () => {
    // Mirrors backend/bookings/pdf.py::_pct — the two must never disagree,
    // which is exactly what produced "9%" on screen and "8%" on the PDF.
    expect(formatPercent(8.5)).toBe("8.5");
    expect(formatPercent(2.5)).toBe("2.5");
  });
});
