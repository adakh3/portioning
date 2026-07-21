# Locale cleanup (USD / MM-DD / 12h / Tax ID)

## User story

**As a** US caterer using the app,
**I want** currency, tax wording, and dates to read as `$` / "Sales Tax" /
MM-DD-YYYY / 12-hour everywhere — including PDFs,
**so that** the product looks native to my market, never showing UK `£`/VAT.

## Context

The app was built UK-first: 10+ files each carried their own `£`/VAT/`DD/MM/YYYY`
fallback, so a US org leaked pound signs on whichever page was missed. Wave 0:

- **Single source** — `lib/orgLocale.tsx` (`useOrgLocale()`) is now the one place
  currency/tax/date/time come from, with a **neutral loading state** (em-dash, not
  a hardcoded symbol). A **guard test** (`lib/orgLocale.guard.test.ts`) fails CI if
  a raw `£` / `"GBP"` / `"VAT"` literal reappears in app source.
- **Backend** — `country_defaults.py` now also sets `time_format` (US → 12h);
  `bookings/pdf.py` requires the org currency symbol (no `£` default); model
  `__str__`s drop `£`; `Venue.country` / `Account.billing_country` derive from the
  org's country on new rows; "VAT Number" → "Tax ID" (label only, field kept).
- **"Big Eaters" → "Hearty eaters"** (label only; `big_eaters*` fields unchanged),
  with helper text noting the percentage is configurable (default 20%).
- **No bulk rewrite** of existing orgs — an operator runs
  `python manage.py apply_country_defaults --org "<name>"` by hand for a
  mis-provisioned org.
- **Legacy-org snapshot gate** — a fixture desi org (£/VAT, gents/ladies split)
  whose totals + quote-PDF text are pinned, so later waves can't regress it.

## Manual test cases

1. **US org, everywhere `$`.** Create an org with country US; confirm dashboard,
   quotes, events, invoices, staff, equipment and both PDFs show `$`, "Sales Tax",
   MM-DD-YYYY and 12-hour times — no `£`/VAT anywhere.
2. **Neutral loading.** On a slow load, money/dates render as `—` briefly, never
   `£`.
3. **Existing desi org unchanged.** An org with explicit £/VAT still shows pounds
   and "VAT" on screen and in its quote PDF (the snapshot gate proves this).
4. **Tax ID label.** The account form/detail reads "Tax ID", not "VAT Number"
   (the stored value is unchanged).
5. **Hearty eaters.** The portions checkbox reads "Hearty eaters" with the helper
   text; the editable percentage still works.
6. **By-hand re-provision.** `apply_country_defaults --org "<name>"` updates that
   one org's locale from its country; `--dry-run` writes nothing.
