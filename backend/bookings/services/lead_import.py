import csv
import io
import re
from dataclasses import dataclass, field
from datetime import datetime

from bookings.models import Lead


# Map Excel event types to model choices
EVENT_TYPE_MAP = {
    "valimah": "wedding",
    "barat_": "wedding",
    "barat": "wedding",
    "nikkah": "wedding",
    "mehndi_": "wedding",
    "mehndi": "wedding",
    "enagagement": "wedding",
    "engagement": "wedding",
    "corporate": "corporate",
    "birthday": "birthday",
}

# Map guest range strings to midpoint estimates
GUEST_MAP = {
    "100_-_200_persons": 150,
    "200_-_300_persons": 250,
    "300_-_400_persons": 350,
    "400_-_500_persons": 450,
    "500__&_more": 600,
}

# Map Excel statuses to model statuses
STATUS_MAP = {
    "CREATED": "new",
    "Done": "contacted",
}

SOURCE_MAP = {
    "fb": "facebook",
    "ig": "instagram",
}


def parse_event_date(raw):
    """Best-effort parse of freeform date strings like '28 march', 'April 11', '10 june 2026'."""
    if not raw or "test lead" in str(raw).lower() or "not confirm" in str(raw).lower():
        return None

    raw = str(raw).strip()

    for fmt in ("%d %B %Y", "%d %B", "%B %d", "%d %b %Y", "%d %b", "%b %d",
                "%d %B, %Y", "%B %Y", "%B"):
        try:
            dt = datetime.strptime(raw, fmt)
            if dt.year == 1900:
                dt = dt.replace(year=2026)
            return dt.date()
        except ValueError:
            continue

    match = re.search(
        r"(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{4})?",
        raw, re.I,
    )
    if match:
        day, month_str, year_str = match.groups()
        year = int(year_str) if year_str else 2026
        try:
            return datetime.strptime(f"{day} {month_str} {year}", "%d %b %Y").date()
        except ValueError:
            pass

    match = re.search(
        r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*(\d{1,2})?,?\s*(\d{4})?",
        raw, re.I,
    )
    if match:
        month_str, day_str, year_str = match.groups()
        day = int(day_str) if day_str else 1
        year = int(year_str) if year_str else 2026
        try:
            return datetime.strptime(f"{day} {month_str} {year}", "%d %b %Y").date()
        except ValueError:
            pass

    return None


@dataclass
class ImportRow:
    row_num: int = 0
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    event_type: str = "other"
    event_type_raw: str = ""
    guest_estimate: int | None = None
    event_date: object = None  # date or None
    lead_date: object = None  # date or None
    source: str = "website"
    status: str = "new"
    notes: str = ""
    skipped: bool = False
    skip_reason: str = ""
    error: str = ""
    created: bool = False
    duplicate_warning: bool = False


def parse_rows(data_rows, header):
    """Parse raw spreadsheet rows into ImportRow objects. Pure function, no DB access."""
    col = {name: i for i, name in enumerate(header)}
    required = ["full_name", "email", "event_type"]
    for r in required:
        if r not in col:
            raise ValueError(f"Missing required column: {r}")

    results = []
    for i, row in enumerate(data_rows, start=2):
        ir = ImportRow(row_num=i)

        name = str(row[col["full_name"]] or "").strip()
        email = str(row[col.get("email", "")] or "").strip()
        phone = str(row[col.get("phone_number", "")] or "").strip()

        # Skip test leads
        if "test lead" in name.lower() or "test lead" in email.lower():
            ir.contact_name = name
            ir.contact_email = email
            ir.skipped = True
            ir.skip_reason = "Test lead"
            results.append(ir)
            continue

        # Skip empty rows
        if not name and not email:
            ir.skipped = True
            ir.skip_reason = "Empty row"
            results.append(ir)
            continue

        phone = re.sub(r"^p:", "", phone).strip()

        event_type_raw = str(row[col.get("event_type", "")] or "").strip().lower()
        event_type = EVENT_TYPE_MAP.get(event_type_raw, "other")

        guest_raw = str(row[col.get("your_guests", "")] or "").strip()
        guest_estimate = GUEST_MAP.get(guest_raw)

        date_raw = row[col.get("your_event_date", "")]
        event_date = parse_event_date(date_raw)

        lead_date_raw = row[col.get("lead_date", "")]
        lead_date = parse_event_date(lead_date_raw)
        # Also try datetime objects (common in xlsx)
        if not lead_date and lead_date_raw:
            if hasattr(lead_date_raw, 'date'):
                lead_date = lead_date_raw.date()
            elif hasattr(lead_date_raw, 'year'):
                lead_date = lead_date_raw

        platform = str(row[col.get("platform", "")] or "").strip().lower()
        source = SOURCE_MAP.get(platform, platform or "website")

        status_raw = str(row[col.get("lead_status", "")] or "").strip()
        status = STATUS_MAP.get(status_raw, "new")

        campaign = str(row[col.get("campaign_name", "")] or "").strip()
        notes_parts = []
        if campaign:
            notes_parts.append(f"Campaign: {campaign}")
        if event_type_raw and event_type_raw != event_type:
            notes_parts.append(f"Event subtype: {event_type_raw}")
        if date_raw and not event_date:
            notes_parts.append(f"Date (unparsed): {date_raw}")

        ir.contact_name = name[:200]
        ir.contact_email = email[:254]
        ir.contact_phone = phone[:50]
        ir.event_type = event_type
        ir.event_type_raw = event_type_raw
        ir.guest_estimate = guest_estimate
        ir.event_date = event_date
        ir.lead_date = lead_date
        ir.source = source[:50]
        ir.status = status
        ir.notes = "\n".join(notes_parts)

        results.append(ir)

    return results


def load_xlsx(file_obj, sheet_name=None):
    """Load an Excel file. Returns (header, data_rows, sheet_names)."""
    import openpyxl

    wb = openpyxl.load_workbook(file_obj, read_only=True)
    sheet_names = wb.sheetnames

    if sheet_name and sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
    else:
        ws = wb[wb.sheetnames[0]]

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], [], sheet_names

    header = rows[0]
    data_rows = rows[1:]
    return header, data_rows, sheet_names


def load_csv(file_obj):
    """Load a CSV file. Returns (header, data_rows, [])."""
    text = file_obj.read()
    if isinstance(text, bytes):
        text = text.decode("utf-8-sig")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return [], [], []

    header = tuple(rows[0])
    data_rows = [tuple(r) for r in rows[1:]]
    return header, data_rows, []


def flag_duplicates(import_rows):
    """Mark rows whose email already exists in the DB. Warning only, does not block."""
    emails = [r.contact_email.lower() for r in import_rows if r.contact_email and not r.skipped]
    if not emails:
        return
    existing = set(
        Lead.objects.filter(contact_email__in=emails)
        .values_list("contact_email", flat=True)
    )
    existing_lower = {e.lower() for e in existing}
    for row in import_rows:
        if row.contact_email and row.contact_email.lower() in existing_lower:
            row.duplicate_warning = True


def commit_rows(import_rows, product=None, assigned_to=None):
    """Create Lead objects for valid (non-skipped) rows. Returns (created_count, errors)."""
    created = 0
    errors = []
    for row in import_rows:
        if row.skipped or row.error:
            continue
        try:
            Lead.objects.create(
                contact_name=row.contact_name,
                contact_email=row.contact_email,
                contact_phone=row.contact_phone,
                event_type=row.event_type,
                guest_estimate=row.guest_estimate,
                event_date=row.event_date,
                lead_date=row.lead_date,
                source=row.source,
                status=row.status,
                notes=row.notes,
                product=product,
                assigned_to=assigned_to,
            )
            row.created = True
            created += 1
        except Exception as e:
            row.error = str(e)
            errors.append(f"Row {row.row_num}: {e}")
    return created, errors
