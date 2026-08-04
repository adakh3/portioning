"""The BEO — Banquet Event Order, the day-of sheet the kitchen actually cooks from.

The sibling document, ``generate_event_pdf`` ("EVENT FUNCTION SHEET"), is
client-facing: it carries the money and doubles as the signed contract. This one is
its **ops-facing** counterpart over the same event — same timeline, same menu, but
organised for execution and deliberately carrying **no prices at all** (AC10). Two
audiences, two documents; a caterer can hand this to a venue or a banquet captain
without handing over what the client paid.

Rendering only. Everything that decides *what* belongs on the sheet — which covers
are vendors, whether the entrée tallies have landed, whether a re-issue counts as a
revision — lives in ``bookings/services/beo.py`` and is unit-testable without a PDF.
Styles, page geometry and the escaping helper are imported from ``bookings/pdf.py``
rather than copied, so the two documents can't drift apart visually.
"""
import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

from bookings.models.settings import OrgSettings
from bookings.models.choices import EventTypeOption, ServiceStyleOption, MealTypeOption
from bookings.pdf import (
    BG_SUBTLE, BORDER_LIGHT, CONTENT_W, LEGACY_PDF_LABELS, MARGIN,
    _choice_label, _dish_table, _dt_fmt, _esc, _section_header, _styles,
)
from bookings.services.beo import beo_choice_tallies, beo_guest_breakdown, beo_vendor_meals
from bookings.services.timeline import booking_timeline, format_timeline_row
from dishes.ordering import dish_display_names_in_added_order


def _label_value_table(rows, s, label_w=0.25):
    """The plain two-column "Label: value" table every block on this sheet uses."""
    data = [[Paragraph(_esc(label), s['info_label']), Paragraph(_esc(value), s['info_value'])]
            for label, value in rows]
    t = Table(data, colWidths=[CONTENT_W * label_w, CONTENT_W * (1 - label_w)])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


def _grid(title, header_cells, rows, col_widths, s):
    """A titled table (staffing, equipment) with column heads and row separators."""
    out = [Paragraph(f'<b>{title}</b>', s['section_heading'])]
    head = _section_header([Paragraph(c, s['section_title']) for c in header_cells], col_widths)
    body = Table([[Paragraph(_esc(c), s['body']) for c in row] for row in rows], colWidths=col_widths)
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    for i in range(len(rows)):
        style.append(('LINEBELOW', (0, i), (-1, i), 0.25, BORDER_LIGHT))
    body.setStyle(TableStyle(style))
    return out + [head, body, Spacer(1, 6 * mm)]


def _shift_window(shift, time_format):
    """"01 Aug 2026, 14:00 – 22:00" — the end date is printed only when the shift
    runs past midnight, which is exactly when a reader needs to be told."""
    fmt = _dt_fmt(time_format)
    start = shift.start_time.strftime(fmt)
    if shift.end_time.date() == shift.start_time.date():
        end = shift.end_time.strftime('%I:%M %p' if time_format == '12h' else '%H:%M')
    else:
        end = shift.end_time.strftime(fmt)
    return f'{start} – {end}'


def _header_flowables(event, s):
    """Org name, document title, and the identity line the whole sheet hangs off:
    which BEO this is and which revision of it."""
    org_name = event.organisation.name if event.organisation_id else ''
    out = [
        Paragraph(_esc(org_name), s['org_name']),
        Spacer(1, 1 * mm),
        Paragraph('BANQUET EVENT ORDER', s['section_heading']),
    ]
    # BEO number is the event's own id (a per-org sequence is deferred) — stable for
    # the life of the booking, which is the only property the kitchen needs from it.
    ident = f'BEO #{event.pk} · Rev {event.beo_revision or 1}'
    if event.beo_revised_at:
        ident += f' · Revised {event.beo_revised_at.strftime("%d %b %Y, %H:%M")}'
    out.append(Paragraph(ident, s['body_bold']))
    divider = Table([['']], colWidths=[CONTENT_W])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, 0), 2),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 0),
    ]))
    out += [Spacer(1, 2 * mm), divider, Spacer(1, 6 * mm)]
    return out


def _info_block_flowables(event, s):
    """Who/where on the left, when/what on the right — the sheet's identity block."""
    contact = event.primary_contact
    customer = contact.name if contact else (event.account.name if event.account_id else '—')
    left_rows = [[Paragraph(f'<b>{_esc(event.name or customer)}</b>', s['info_header']), '']]
    left_rows.append([Paragraph('Customer:', s['info_label']), Paragraph(_esc(customer), s['info_value'])])
    if event.account_id:
        left_rows.append([Paragraph('Business:', s['info_label']),
                          Paragraph(_esc(event.account.name), s['info_value'])])
    if event.venue:
        parts = [event.venue.name]
        addr = [p for p in [event.venue.address_line1, event.venue.city] if p]
        if addr:
            parts.append(', '.join(addr))
        left_rows.append([Paragraph('Venue:', s['info_label']),
                          Paragraph(_esc(' — '.join(parts)), s['info_value'])])
    elif event.venue_address:
        left_rows.append([Paragraph('Venue:', s['info_label']),
                          Paragraph(_esc(event.venue_address), s['info_value'])])

    LEFT_W = CONTENT_W * 0.52
    left = Table(left_rows, colWidths=[LEFT_W * 0.28, LEFT_W * 0.72])
    left.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
    ]))

    org = event.organisation
    right_rows = [
        ('Event Date:', event.event_date.strftime('%d %B %Y')),
        ('Event Day:', event.event_date.strftime('%A')),
        ('Status:', event.get_status_display()),
    ]
    for label, value in [
        ('Event Type:', _choice_label(EventTypeOption, event.event_type, org)),
        ('Meal Type:', _choice_label(MealTypeOption, event.meal_type, org)),
        ('Service Style:', _choice_label(ServiceStyleOption, event.service_style, org)),
    ]:
        if value:
            right_rows.append((label, value))

    RIGHT_W = CONTENT_W * 0.48
    right_info = Table(
        [[Paragraph(_esc(label), s['info_label']), Paragraph(_esc(value), s['info_value'])]
         for label, value in right_rows],
        colWidths=[RIGHT_W * 0.45, RIGHT_W * 0.55],
    )
    right_info.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (-1, -1), BG_SUBTLE),
    ]))
    right = Table([[_section_header([Paragraph('EVENT DETAILS', s['section_title'])], [RIGHT_W])],
                   [right_info]], colWidths=[RIGHT_W])
    right.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))

    outer = Table([[left, right]], colWidths=[LEFT_W, RIGHT_W])
    outer.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0), ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0), ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return [outer, Spacer(1, 8 * mm)]


def _guest_flowables(event, s):
    """The numbers to cook to: the in-count breakdown, the additional covers that
    sit outside it, and where the guarantee currently stands (AC5)."""
    breakdown = beo_guest_breakdown(event)
    rows = [(f'{name}:', str(count)) for name, count in breakdown['in_count']]
    rows.append(('Total guests:', str(breakdown['in_count_total'])))
    for name, count in breakdown['additional']:
        rows.append((f'{name} (additional cover):', str(count)))
    if breakdown['additional']:
        rows.append(('Total covers:', str(breakdown['in_count_total'] + breakdown['additional_total'])))
    if event.guaranteed_count is not None:
        rows.append(('Guaranteed count:', str(event.guaranteed_count)))
    if event.final_count is not None:
        rows.append(('Final count:', str(event.final_count)))
    if event.final_count_due:
        rows.append(('Final count due:', event.final_count_due.strftime('%d %B %Y')))
    return [
        _section_header([Paragraph('GUEST COUNT', s['section_title'])], [CONTENT_W]),
        _label_value_table(rows, s),
        Spacer(1, 6 * mm),
    ]


def _timeline_flowables(event, s, time_format):
    """The run of the day — the booking's own entries when it has any, else the four
    legacy slots. Entries-win-else-legacy, never a union: the same rule the other two
    surfaces follow, so all three documents describe the same day (AC3)."""
    rows = [(row.label, format_timeline_row(row, time_format))
            for row in booking_timeline(event, LEGACY_PDF_LABELS)]
    if not rows:
        return []
    return [
        _section_header([Paragraph('TIMELINE', s['section_title'])], [CONTENT_W]),
        _label_value_table(rows, s),
        Spacer(1, 6 * mm),
    ]


def _choice_tally_flowables(tallies, course_id, event, s):
    """Under a course that offers a choice: the per-dish tallies once the client has
    sent them, or a line saying they're still owed (AC7).

    Printing nothing while the numbers are outstanding would read as "no choices" —
    the one thing a kitchen must not conclude the week of the event.
    """
    tally = tallies.get(course_id)
    if not tally:
        return []
    if not tally['recorded']:
        pending = f"{tally['course_name'] or 'Menu'} choices pending"
        if event.final_count_due:
            pending += f" (due {event.final_count_due.strftime('%d %b %Y')})"
        return [Paragraph(_esc(pending), s['note_grey']), Spacer(1, 2 * mm)]
    out = []
    for name, count in tally['rows']:
        out.append(Paragraph(f'{_esc(name)} — <b>{"—" if count is None else count}</b>', s['body']))
    return out + [Spacer(1, 2 * mm)]


def _menu_flowables(event, s):
    """The menu, grouped by course with the booking-level service style stated once,
    every dish carrying its dietary suffix, and each choice course's tallies beneath
    it. A course-less event falls back to the flat added-order list (AC4)."""
    from bookings.services.presentation import booking_menu_courses

    dish_names = dish_display_names_in_added_order(event)
    courses = booking_menu_courses(event, with_dietary=True)
    if not dish_names and not courses:
        return []

    out = [_section_header([Paragraph('MENU', s['section_title'])], [CONTENT_W]), Spacer(1, 2 * mm)]
    style_label = _choice_label(ServiceStyleOption, event.service_style, event.organisation)
    if style_label:
        # Booking-level, printed once: courses are grouping only (REL-417), so a
        # per-course service style would be inventing a distinction that isn't stored.
        out.append(Paragraph(f'Service style: <b>{_esc(style_label)}</b>', s['body']))
        out.append(Spacer(1, 2 * mm))

    if not courses:
        out += [_dish_table(dish_names, s), Spacer(1, 6 * mm)]
        return out

    tallies = beo_choice_tallies(event)
    for group in courses:
        if not group['items']:
            continue
        out.append(Paragraph(f"<b>{_esc(group['name'] or 'Additional dishes')}</b>", s['body']))
        out.append(Spacer(1, 1 * mm))
        out.append(_dish_table(group['items'], s))
        out.append(Spacer(1, 2 * mm))
        out += _choice_tally_flowables(tallies, group['course_id'], event, s)
        out.append(Spacer(1, 2 * mm))
    out.append(Spacer(1, 4 * mm))
    return out


def _meal_flowables(event, s, time_format):
    """Additional meals — welcome drinks, a late-night table — with what's served and
    when, and never a price. Vendor-audience meals are excluded: they render in their
    own block below so the covers outside the guest count read as the exception they
    are, rather than getting lost among the client's own extra services."""
    from events.models import MealAudience

    out = []
    for meal in event.additional_meals.all():
        is_vendor = (meal.audience == MealAudience.SEGMENT
                     and meal.audience_segment_id is not None
                     and not meal.audience_segment.counts_toward_total)
        if is_vendor:
            continue
        line = f'{meal.label or "Additional meal"} — {meal.guest_count} covers'
        if meal.meal_time:
            line += f' @ {meal.meal_time.strftime(_dt_fmt(time_format))}'
        out.append(Paragraph(f'<b>{_esc(line)}</b>', s['body']))
        dishes = dish_display_names_in_added_order(meal)
        if dishes:
            out.append(Spacer(1, 1 * mm))
            out.append(_dish_table(dishes, s))
        out.append(Spacer(1, 3 * mm))
    if not out:
        return []
    return [_section_header([Paragraph('ADDITIONAL MEALS', s['section_title'])], [CONTENT_W]),
            Spacer(1, 2 * mm)] + out + [Spacer(1, 3 * mm)]


def _vendor_flowables(event, s, time_format):
    """Vendor/crew covers — omitted entirely when there are none (AC6)."""
    rows = beo_vendor_meals(event)
    if not rows:
        return []
    out = [_section_header([Paragraph('VENDOR MEALS', s['section_title'])], [CONTENT_W]),
           Spacer(1, 2 * mm)]
    for row in rows:
        line = f"{row['name']} — {row['count']} covers"
        if row['label']:
            line += f" ({row['label']})"
        if row['time']:
            line += f" @ {row['time'].strftime(_dt_fmt(time_format))}"
        out.append(Paragraph(f'<b>{_esc(line)}</b>', s['body']))
        if row['served']:
            out.append(Spacer(1, 1 * mm))
            out.append(_dish_table(row['served'], s))
        else:
            # No meal of their own: they eat what everyone else eats, and saying so
            # is the difference between "cook 8 more" and "cook nothing".
            out.append(Paragraph('Served from the main menu.', s['note_grey']))
        out.append(Spacer(1, 3 * mm))
    return out


def _staffing_flowables(event, s, time_format):
    """Who is on, in what role, between when and when — omitted when empty (AC8)."""
    shifts = list(event.shifts.all())
    if not shifts:
        return []
    rows = [
        (shift.role.name,
         shift.staff_member.name if shift.staff_member else 'Unassigned',
         _shift_window(shift, time_format))
        for shift in shifts
    ]
    return _grid('STAFFING', ['ROLE', 'STAFF', 'SHIFT'], rows,
                 [CONTENT_W * 0.28, CONTENT_W * 0.30, CONTENT_W * 0.42], s)


def _equipment_flowables(event, s):
    """What to load — item and quantity out, omitted when empty (AC8).

    No delivery/pickup windows: the model has no such fields, and a rendered window
    the caterer can't set would be a promise nobody made.
    """
    reservations = list(event.equipment_reservations.all())
    if not reservations:
        return []
    rows = [(r.equipment.name, str(r.quantity_out)) for r in reservations]
    return _grid('EQUIPMENT', ['ITEM', 'QTY'], rows,
                 [CONTENT_W * 0.75, CONTENT_W * 0.25], s)


def _instruction_flowables(event, s):
    """Kitchen / banquet / setup free text, each omitted when blank (AC9)."""
    out = []
    for title, text in [
        ('KITCHEN INSTRUCTIONS', event.kitchen_instructions),
        ('BANQUET INSTRUCTIONS', event.banquet_instructions),
        ('SETUP INSTRUCTIONS', event.setup_instructions),
    ]:
        if not (text and text.strip()):
            continue
        out.append(_section_header([Paragraph(title, s['section_title'])], [CONTENT_W]))
        out.append(Spacer(1, 2 * mm))
        for para in text.split('\n'):
            if para.strip():
                out.append(Paragraph(_esc(para.strip()), s['note']))
        out.append(Spacer(1, 6 * mm))
    return out


def _contact_flowables(event, s):
    """Who to ring on the day (AC9) — omitted when nobody is reachable."""
    rows = []
    contact = event.primary_contact
    if contact:
        rows.append(('Customer:', contact.name))
        if contact.phone:
            rows.append(('Customer phone:', contact.phone))
        if contact.email:
            rows.append(('Customer email:', contact.email))
    venue = event.venue
    if venue:
        address = ', '.join(p for p in [venue.address_line1, venue.address_line2,
                                        venue.city, venue.postcode] if p)
        rows.append(('Venue:', venue.name))
        if address:
            rows.append(('Venue address:', address))
        if venue.contact_name:
            rows.append(('Venue contact:', venue.contact_name))
        if venue.contact_phone:
            rows.append(('Venue phone:', venue.contact_phone))
        if venue.contact_email:
            rows.append(('Venue email:', venue.contact_email))
    elif event.venue_address:
        rows.append(('Venue address:', event.venue_address))
    if not rows:
        return []
    return [
        _section_header([Paragraph('CONTACTS', s['section_title'])], [CONTENT_W]),
        _label_value_table(rows, s, label_w=0.3),
        Spacer(1, 6 * mm),
    ]


def generate_beo_pdf(event):
    """Render the event's BEO and return the PDF bytes.

    Reads ``beo_revision``/``beo_revised_at`` off the event as given — moving the
    counter is ``record_beo_issue``'s job, so rendering the same event twice always
    produces the same document.
    """
    settings = OrgSettings.for_org(event.organisation)
    time_format = settings.time_format

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=MARGIN, bottomMargin=MARGIN, leftMargin=MARGIN, rightMargin=MARGIN,
    )
    s = _styles()

    elements = []
    elements += _header_flowables(event, s)
    elements += _info_block_flowables(event, s)
    elements += _guest_flowables(event, s)
    elements += _timeline_flowables(event, s, time_format)
    elements += _menu_flowables(event, s)
    elements += _meal_flowables(event, s, time_format)
    elements += _vendor_flowables(event, s, time_format)
    elements += _staffing_flowables(event, s, time_format)
    elements += _equipment_flowables(event, s)
    elements += _instruction_flowables(event, s)
    elements += _contact_flowables(event, s)

    doc.build(elements)
    return buf.getvalue()
