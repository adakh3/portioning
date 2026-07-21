# Client e-signature (v1)

## User story
As a **caterer**, I want to send my client a secure link where they can **view a
quote (or event) and accept & sign it online**, so that I close the deal without
printing, posting, or chasing a physical signature — and so the acceptance is
recorded with a tamper-evident audit trail.

## Background
E-signature on proposals is table-stakes for the US/UK competitors (Total Party
Planner, Flex Catering, Event Temple — see `docs/COMPETITIVE_ANALYSIS.md`); this
app had none. v1 adds a **sign-once** flow, deliberately without re-sign/amendment
logic (bookings change constantly after signing — the signature is a point-in-time
record, not a live gate; the real number reconciles at the final invoice).

Because the **event is the fundamental object**, signing plugs into the existing
pipeline rather than competing with it: accepting a quote already auto-creates the
confirmed event (menu + kitchen portions + totals), so the client's signature simply
**fires that same `accept_quote` pipeline**. A booking created directly as an event
(no quote) can be signed too — that confirms the event.

Design notes:
- The client link is an **unauthenticated, unguessable token** (`public_token` on
  Quote/Event). Public endpoints resolve it via the sanctioned cross-org bypass
  (`unscoped()`) and only ever return **customer-safe** fields — never
  `internal_notes` or costs.
- Each signature is an **immutable `BookingSignature`** (snapshot of the agreed
  total, a frozen signed PDF, plus signer name, timestamp, IP, user-agent) — the
  attribution that makes it valid under the US ESIGN Act / UAE e-transactions law.
- A booking can hold **many** signatures over time (so a future amendment/change-order
  flow slots in without rework), but v1 is single-sign and idempotent.

## Acceptance criteria
- [ ] On a **draft/sent quote**, a staff member sees a **"Send for signature"** control that mints a link and (for a draft) marks the quote **Sent**; the shareable `…/b/<token>` URL can be copied.
- [ ] On a **tentative event**, the same control mints a link for a directly-created booking.
- [ ] Opening `/b/<token>` **without logging in** shows a branded, read-only view: business name, reference, customer, event details, menu grouped by category, charges, totals, and terms.
- [ ] The public view **never** shows internal notes or cost/margin data.
- [ ] The client accepts by entering their **full name** and ticking a **consent** box (an optional drawn signature is available); the button is disabled until name + consent are provided.
- [ ] Signing a **quote** moves it to **Accepted** and **auto-creates the confirmed event** (menu, kitchen portions, add-ons, totals) — identical to the staff "Accept & Create Event" path.
- [ ] Signing an **event** moves it **Tentative → Confirmed**.
- [ ] After signing, the client sees an **"Accepted & signed"** confirmation and can **download the signed PDF**; the staff quote/event page shows **"Signed by <name> on <date>"**.
- [ ] Signing is **idempotent** — refreshing or re-submitting does not create a second signature or change anything.
- [ ] An **expired** or **declined** quote can no longer be signed (the link shows it's unavailable).
- [ ] The signature record stores the agreed total, timestamp, IP, and a frozen PDF of exactly what was signed.

## Manual test cases

### TC1 — Send a quote for signature
**Steps:** Open a **draft** quote → click **Send for signature**.
**Expected:** The quote flips to **Sent**; a **Client sign link** (`…/b/<token>`) appears with a **Copy link** button.

### TC2 — Client views the quote (logged out)
**Steps:** Open the copied link in a private/incognito window (not logged in).
**Expected:** A branded read-only page shows the menu, charges, totals and terms. No login prompt. No internal notes anywhere.

### TC3 — Accept & sign
**Steps:** Enter a full name, tick the consent box (optionally draw a signature), click **Accept & sign**.
**Expected:** An **Accepted & signed** confirmation appears with a **Download signed copy (PDF)** link. Back in staff view, the quote is **Accepted**, an **event was created** (View Event), and the panel shows **Signed by <name>**.

### TC4 — Signed booking is immutable to re-sign
**Steps:** Refresh the client link / resubmit.
**Expected:** It shows the signed state; no duplicate signature is created.

### TC5 — Sign a direct event
**Steps:** Create an event directly (no quote), status **Tentative** → **Send for signature** → open link → sign.
**Expected:** The event becomes **Confirmed**; staff view shows the signature.

### TC6 — Expired quote can't be signed
**Steps:** On a sent quote with a past **valid until** date, open its link and try to sign.
**Expected:** The page reports the booking can no longer be accepted online; no signature is recorded.

### TC7 — Internal notes never leak
**Steps:** Put text in a quote's **internal notes**, send for signature, open the client link, and download the signed PDF.
**Expected:** The internal-notes text appears in **neither** the web view **nor** the PDF.

### TC8 — Terms are collapsible on the client page
**Steps:** Open a client sign link for a booking whose org has (long) Terms & Conditions.
**Expected:** Terms show as a collapsed **"Terms & Conditions"** section ("Tap to read") that expands on click — the long text doesn't push the sign form far down the page. Markdown markers (`#`, `**`, `-`) render as clean headings/bold/bullets, not raw symbols.

### TC9 — Signed PDF doesn't print the IP
**Steps:** Sign a booking, download the signed PDF, read the **ACCEPTANCE** block.
**Expected:** It reads "Accepted & signed electronically by \<name\> on \<date, time\>" — **no** IP address. (The IP is still stored on the signature record for audit.)
