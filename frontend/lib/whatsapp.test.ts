import { canWhatsApp, waLink } from "./whatsapp";

describe("WhatsApp deep links", () => {
  it("links E.164 numbers with the text prefilled", () => {
    expect(waLink("+923001269792", "Hello Ms Rizvi,")).toBe(
      "https://wa.me/923001269792?text=Hello%20Ms%20Rizvi%2C",
    );
  });

  it("links without text when none given", () => {
    expect(waLink("+14155238886")).toBe("https://wa.me/14155238886");
  });

  it("refuses junk numbers", () => {
    expect(canWhatsApp("000")).toBe(false);
    expect(canWhatsApp("03001269792")).toBe(false); // not normalized
    expect(canWhatsApp("")).toBe(false);
    expect(canWhatsApp(null)).toBe(false);
    expect(canWhatsApp("+923001269792")).toBe(true);
  });
});
