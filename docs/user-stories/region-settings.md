# Region & Formats — time format (12h / 24h)

**As** an org admin **I want** to choose whether times show as 12-hour (AM/PM) or
24-hour **so that** the app matches how my region reads time.

Builds on the existing org-level **date format** and **currency** settings. The
stored value is always 24-hour `HH:MM`; the setting only changes how times are
**entered** and **displayed**.

## Scope
- New `OrgSettings.time_format` ('24h' default, '12h'). Set in **Settings → Region
  & Formats** ("Time Format").
- Time entry (`TimeField` on the booking timeline + each additional meal):
  - **24h** → hour 0–23 + minute.
  - **12h** → hour 1–12 + minute + AM/PM.
- Time display honours the setting: booking view screens and the **quote/event
  PDF** (timeline times + meal times).

## Manual test cases
1. **Default is 24h** — a fresh org's time fields show hours 0–23, no AM/PM. Times
   render like `19:00`.
2. **Switch to 12h** — Settings → Region & Formats → Time Format → *12-hour AM/PM*
   → Save. Reopen a booking: the timeline time fields now show hour 1–12 + an
   AM/PM dropdown.
3. **Entry round-trips** — in 12h mode pick `7:00 PM` for Setup Time, save, reload
   → still `7:00 PM`. The stored value is `19:00` (24h) under the hood.
4. **PDF matches** — with 12h set, the quote/event PDF shows timeline and meal
   times as `… 07:00 PM`; with 24h, as `… 19:00`.
5. **No data change** — flipping the format never alters the stored time, only its
   presentation (a booking's actual times are unchanged).
