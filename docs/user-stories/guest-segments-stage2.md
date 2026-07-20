# Guest segments — stage 2 (N-segment portioning engine)

## User story

**As a** caterer serving mixed guest types (adults, kids, vendor/crew meals — or
gents/ladies),
**I want** the portioning engine to compute food for each guest segment by its own
appetite, and to treat crew/vendor meals as extra covers rather than guests,
**so that** kitchen quantities are right for the real mix of people, not just a
single head count.

## Context

Stage 1 (REL-408) laid the data model: `rules.GuestSegment` (named, per-org, with a
`portion_multiplier`) and `events.BookingGuestCount` (per-segment counts on a
booking), backfilled from the legacy gents/ladies columns but **not yet read**.

Stage 2 (REL-410) makes segments real:

- The portioning engine now expands portions over **N segments** (each scaled by
  its multiplier), replacing the hardcoded gents/ladies split. Portions sum over
  **all covers**.
- A new `GuestSegment.counts_toward_total` flag distinguishes **in-count** segments
  (Adults, Kids) from **additional covers** (Vendors) that are portioned for but
  excluded from the guest count.
- `Event.portioning_guests()` resolves `BookingGuestCount` rows (count-first:
  falling back to the legacy split, then the org's default segment).
- **Dual-write:** editing gents/ladies keeps `BookingGuestCount` in sync while the
  columns are deprecated (not dropped).

**No visible UI change** — the frontend still edits gents/ladies. Existing (desi)
orgs are unaffected: it's an internals swap proven by parity tests. The
segment-aware breakdown UI ships later (Wave 2a / REL-405).

## Manual test cases

1. **Parity (existing orgs).** A gents/ladies org's cooking sheet / portioning
   output is identical before and after this change. (Automated: the engine parity
   test asserts the segment path == the legacy dict path, incl. a ladies
   multiplier ≠ 1.0.)
2. **Kids eat less.** An org with Adults (1.0) + Kids (0.6): a booking of 100
   adults + 40 kids portions each dish at `base` for adults and `base × 0.6` for
   kids; totals sum over 140 covers.
3. **Additional covers.** A booking of 150 guests + 8 vendor covers (Vendors,
   `counts_toward_total = false`) cooks for **158** covers, while the headline
   guest count stays **150**.
4. **Count-first fallback.** A booking with a guest count but no per-segment
   breakdown and no gents/ladies split portions the whole count under the org's
   default segment (`is_default`).
5. **Dual-write.** Editing an event's gents/ladies via the UI updates both the
   `BookingGuestCount` rows and the legacy columns; clearing the split removes the
   rows; the PDF / cooking sheet is unchanged.
