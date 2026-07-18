/** WhatsApp deep-link helpers (shortcut mode — no Twilio required).
 *
 * wa.me wants bare international digits (no +, no leading zeros) and an
 * URL-encoded prefill text. Numbers in this app are stored E.164 (+9230...),
 * so anything not starting with '+' is junk we refuse to link to.
 */

export function canWhatsApp(phone?: string | null): boolean {
  return !!phone && /^\+\d{7,15}$/.test(phone);
}

export function waLink(phone: string, text?: string): string {
  const digits = phone.replace(/^\+/, "");
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${query}`;
}
