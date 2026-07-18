# WhatsApp shortcuts (stage one — no Twilio required)

**As a** salesperson in an org that hasn't set up Twilio, **I want** one-tap
WhatsApp buttons that open the chat with the message ready, **so that** I can
send AI follow-ups and share quotations from my own phone/WhatsApp Web today,
while the CRM still records what was sent — keeping the AI's ledger truthful.

## How it works
- **Auto-switch, per org:** Twilio configured → in-app sending as today, no
  shortcuts anywhere. Not configured → shortcut buttons appear instead.
  Upgrading to Twilio later retires the shortcuts automatically.
- **Draft cards:** "Send via WhatsApp" opens `wa.me/<number>` with the (edited)
  draft body prefilled. The card then asks **"Did you send it?"** — *Mark sent*
  flips the draft to sent, writes the message into the lead's WhatsApp thread
  as a manual record, and logs activity (the scheduler's sent-count, spacing
  and cap all stay truthful); *Not sent* returns the card to pending.
- **Lead page (no-Twilio orgs):** a small WhatsApp section with a chat chip
  (no prefill) and a **"Customer replied"** button that logs an inbound marker
  with the current timestamp — no text captured (it lives on the rep's phone)
  — keeping the reply-pause rule and "days quiet" honest.
- **Reminder cards:** the same chat chip.
- **Quote page:** **"Share via WhatsApp"** opens the customer's chat with a
  minimal greeting ("Hello <title/name>, sharing your quotation for <event>") —
  the rep attaches the PDF in WhatsApp themselves. Confirming the share
  **flips the quote draft → sent automatically**, logs activity on the quote
  AND on its lead (so the AI's quote facts become true), and records the
  message on the lead's thread. This button shows regardless of Twilio (it is
  currently the only quote-share path).
- **Guardrails:** shortcuts render only when the number normalized to
  international form (junk like "000" gets no button); same role scoping as
  everything else (salespeople act only on their own leads/drafts).

### Accepted trade-offs (owner sign-off)
Personal numbers (relationship lives on the rep's phone), no inbound text
capture, no bulk send, honor-system delivery. Twilio remains the built,
one-credential upgrade whenever these bite.

## Acceptance criteria
- [ ] With Twilio unconfigured: draft cards show "Send via WhatsApp" (not
      "Approve & Send"); with Twilio configured, the reverse.
- [ ] The wa.me link carries the lead's E.164 digits and the edited body.
- [ ] Mark sent: draft → sent; a manual outbound message appears in the lead's
      thread; activity logged; the lead's days-quiet resets; the sent count
      feeds the cap and spacing.
- [ ] Not sent: draft stays pending, nothing logged.
- [ ] "Customer replied": inbound marker in the thread + activity; the lead is
      excluded from generation until the current gap passes.
- [ ] Quote share confirmed: quote draft → sent; activity on quote and lead;
      thread record on the lead; AI context shows "a quotation WAS SENT".
- [ ] Leads with non-E.164 numbers show no shortcut buttons.
- [ ] Salespeople cannot mark-sent or log replies on other reps' leads/drafts.

## Manual test cases
1. **Draft send:** org without Twilio, lead with your own number, generate a
   draft → "Send via WhatsApp" → WhatsApp opens with the text → send → back in
   the app choose *Mark sent* → draft moves out of pending; lead thread shows
   the message; lead page activity shows the send; days-quiet shows 0d.
2. **Not sent:** open the chat, don't send, choose *Not sent* → draft still
   pending, thread unchanged.
3. **Reply log:** tap "Customer replied" on that lead → thread shows the
   inbound marker; the lead disappears from the generate preview.
4. **Quote share:** on a draft quote, "Share via WhatsApp" → chat opens with
   greeting → confirm → quote status reads Sent; lead activity shows the
   share; generating a follow-up for that lead produces a draft referencing
   the sent quotation.
5. **Junk number:** lead with phone "000" → no WhatsApp buttons anywhere.
6. **Twilio org:** configure Twilio creds + sender → all shortcuts disappear;
   Approve & Send returns.

## Automated coverage
- Backend: mark-sent endpoint (ledger effects, role scope, pending-only),
  log-reply endpoint (reply-pause effect), quote mark-shared (status flip +
  dual activity + thread record) — `bookings.test_followups` / quote tests.
- Frontend: `lib/whatsapp` link-builder unit tests; page tests for the
  auto-switch, the did-you-send flow, and the quote share flow.
- E2E: draft card renders the WhatsApp button with the correct wa.me href
  against the real backend (local runs genuinely have no Twilio).
