"""Generate professional quotation PDFs matching industry-standard catering format."""
import base64
import io
import math
from decimal import Decimal

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether,
    PageBreak, Image,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from bookings.models.settings import OrgSettings
from bookings.models.choices import EventTypeOption, ServiceStyleOption, MealTypeOption
from dishes.ordering import dish_names_in_added_order


# ── Colour palette ──
DARK = colors.HexColor('#1B2A4A')
BG_SUBTLE = colors.HexColor('#F9FAFB')
BG_ALT_ROW = colors.HexColor('#F3F4F6')
ACCENT = colors.HexColor('#374151')
TEXT_DARK = colors.HexColor('#111111')
TEXT_MUTED = colors.HexColor('#9CA3AF')
TEXT_GREY = colors.HexColor('#6B7280')
BORDER = colors.HexColor('#D1D5DB')
BORDER_LIGHT = colors.HexColor('#D1D5DB')
WHITE = colors.white

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

CATEGORY_LABELS = {
    'food': 'Food',
    'beverage': 'Beverage',
    'rental': 'Rental',
    'labor': 'Labour',
    'fee': 'Fee',
    'discount': 'Discount',
}

UNIT_LABELS = {
    'each': 'Each',
    'per_guest': 'Per Guest',
    'per_hour': 'Per Hour',
    'flat': 'Flat Rate',
}


def _fmt(value, cs):
    """Format a Decimal as a currency string with thousand separators.

    ``cs`` (the org's currency symbol) is required — there is no `£` default, so
    a US org's PDF can never silently render pounds.
    """
    return f'{cs}{value:,.2f}'


def _dt_fmt(time_format='24h'):
    """strftime pattern for a date+time honouring the org's 12h/24h preference."""
    return '%d %b %Y, %I:%M %p' if time_format == '12h' else '%d %b %Y, %H:%M'


def food_summary_text(price_per_head, guest_count, food_total, cs):
    """The 'X per head × N guests = total' food line, or None when there's no
    food cost. Pure + unit-tested (the PDF has no text-extraction test path)."""
    if not food_total or food_total <= 0:
        return None
    return f'{_fmt(price_per_head or 0, cs)} per head × {guest_count} guests = {_fmt(food_total, cs)}'


def meal_line_text(meal, cs, time_format='24h'):
    """One-line summary for an additional meal, or None when it has no price."""
    pph = meal.price_per_head
    if not pph or pph <= 0:
        return None
    total = pph * (meal.guest_count or 0)
    when = ''
    mt = getattr(meal, 'meal_time', None)
    if mt:
        when = f' @ {mt.strftime(_dt_fmt(time_format))}'
    return f'{meal.label or "Additional Meal"}{when} — {_fmt(pph, cs)}/head × {meal.guest_count} = {_fmt(total, cs)}'


def addon_cells(item, cs):
    """(category, description, rate, amount) display strings for one add-on row —
    includes the category label (F3). Pure + unit-tested."""
    unit = UNIT_LABELS.get(item.unit, item.unit)
    desc = item.description
    if item.quantity != 1:
        desc += f'  ({item.quantity} × {unit})'
    return (
        CATEGORY_LABELS.get(item.category, item.category),
        desc,
        _fmt(item.unit_price, cs),
        _fmt(item.line_total, cs),
    )


def _styles():
    """Build paragraph styles used throughout the PDF."""
    base = getSampleStyleSheet()
    return {
        # Header / org name
        'org_name': ParagraphStyle(
            'OrgName', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=18,
            textColor=TEXT_DARK, spaceAfter=0,
        ),
        # Section header text (dark gray on light bg)
        'section_title': ParagraphStyle(
            'SectionTitle', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=8,
            textColor=ACCENT, leading=11,
        ),
        'section_title_right': ParagraphStyle(
            'SectionTitleRight', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=8,
            textColor=ACCENT, leading=11, alignment=TA_RIGHT,
        ),
        # Grand total bar text (white on dark — only use)
        'grand_label': ParagraphStyle(
            'GrandLabel', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=11,
            textColor=WHITE, leading=14, alignment=TA_RIGHT,
        ),
        'grand_value': ParagraphStyle(
            'GrandValue', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=10,
            textColor=WHITE, leading=13, alignment=TA_RIGHT,
        ),
        # Info block labels and values
        'info_label': ParagraphStyle(
            'InfoLabel', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_GREY, leading=11,
        ),
        'info_value': ParagraphStyle(
            'InfoValue', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11,
        ),
        'info_header': ParagraphStyle(
            'InfoHeader', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=10,
            textColor=TEXT_DARK, leading=13,
        ),
        # Table body
        'body': ParagraphStyle(
            'Body', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11,
        ),
        'body_right': ParagraphStyle(
            'BodyRight', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11, alignment=TA_RIGHT,
        ),
        'body_bold': ParagraphStyle(
            'BodyBold', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=8.5,
            textColor=TEXT_DARK, leading=11,
        ),
        'body_bold_right': ParagraphStyle(
            'BodyBoldRight', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=8.5,
            textColor=TEXT_DARK, leading=11, alignment=TA_RIGHT,
        ),
        # Totals
        'totals_label': ParagraphStyle(
            'TotalsLabel', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11, alignment=TA_RIGHT,
        ),
        'totals_value': ParagraphStyle(
            'TotalsValue', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11, alignment=TA_RIGHT,
        ),
        # Notes / T&C
        'section_heading': ParagraphStyle(
            'SectionHeading', parent=base['Normal'],
            fontName='Helvetica-Bold', fontSize=10,
            textColor=ACCENT, spaceBefore=6, spaceAfter=4,
        ),
        'note': ParagraphStyle(
            'Note', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=12, spaceAfter=2,
        ),
        'note_grey': ParagraphStyle(
            'NoteGrey', parent=base['Normal'],
            fontName='Helvetica', fontSize=8,
            textColor=TEXT_GREY, leading=11, spaceAfter=2,
        ),
        # Signature
        'sig_label': ParagraphStyle(
            'SigLabel', parent=base['Normal'],
            fontName='Helvetica', fontSize=8.5,
            textColor=TEXT_DARK, leading=11,
        ),
    }


def _section_header(cells, col_widths):
    """Create a single-row table with subtle gray background (section header)."""
    t = Table([cells], colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BG_SUBTLE),
        ('TOPPADDING', (0, 0), (-1, 0), 5),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 5),
        ('LEFTPADDING', (0, 0), (-1, 0), 6),
        ('RIGHTPADDING', (0, 0), (-1, 0), 6),
        ('LINEBELOW', (0, 0), (-1, 0), 0.25, BORDER_LIGHT),
        ('ROUNDEDCORNERS', [3, 3, 0, 0]),
    ]))
    return t


def _signature_image_flowable(data_url):
    """Turn a PNG data-URL (the client's drawn signature) into a scaled ReportLab
    Image, or None if there isn't a usable one."""
    if not data_url or not data_url.startswith('data:image'):
        return None
    try:
        raw = base64.b64decode(data_url.split(',', 1)[1])
        img = Image(io.BytesIO(raw))
        max_w = 55 * mm
        if img.imageWidth and img.imageWidth > max_w:
            img.drawHeight = img.imageHeight * (max_w / img.imageWidth)
            img.drawWidth = max_w
        return img
    except Exception:
        return None


def _acceptance_block(signature, s):
    """Flowables for the 'ACCEPTANCE' block stamped onto a signed PDF — the drawn
    signature (if any) plus who signed, when, and from where. Empty if unsigned."""
    if signature is None:
        return []
    out = [Spacer(1, 8 * mm),
           _section_header([Paragraph('ACCEPTANCE', s['section_title'])], [CONTENT_W]),
           Spacer(1, 3 * mm)]
    img = _signature_image_flowable(signature.signature_image)
    if img is not None:
        out += [img, Spacer(1, 2 * mm)]
    when = signature.signed_at.strftime('%d %b %Y, %H:%M') if signature.signed_at else ''
    line = f"Accepted &amp; signed electronically by <b>{signature.signer_name}</b>"
    if when:
        line += f" on {when}"
    if signature.ip_address:
        line += f" (IP {signature.ip_address})"
    out.append(Paragraph(line, s['note']))
    return out


def _grand_total_bar(cells, col_widths):
    """Create the grand total row with dark background (only dark bar in PDF)."""
    t = Table([cells], colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK),
        ('TOPPADDING', (0, 0), (-1, 0), 7),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 7),
        ('LEFTPADDING', (0, 0), (-1, 0), 8),
        ('RIGHTPADDING', (0, 0), (-1, 0), 8),
        ('ROUNDEDCORNERS', [0, 0, 3, 3]),
    ]))
    return t


def _dish_table(dish_names, s):
    """A 2-column dish list table (shared by the main menu and each additional
    meal's menu)."""
    half = math.ceil(len(dish_names) / 2)
    col1, col2 = dish_names[:half], dish_names[half:]
    MENU_COL_W = CONTENT_W * 0.50
    rows = []
    for i in range(half):
        right = Paragraph(col2[i], s['body']) if i < len(col2) else Paragraph('', s['body'])
        rows.append([Paragraph(col1[i], s['body']), right])
    t = Table(rows, colWidths=[MENU_COL_W, MENU_COL_W])
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3), ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
    ]
    for i in range(len(rows)):
        style.append(('LINEBELOW', (0, i), (-1, i), 0.25, BORDER_LIGHT))
    t.setStyle(TableStyle(style))
    return t


def _meal_flowables(booking, cs, s, time_format='24h'):
    """Additional-meals section: a summary line per priced meal, plus that meal's
    own dish menu as a table when it has dishes. Shared by both PDFs."""
    meals = list(booking.additional_meals.all())
    out = []
    for m in meals:
        line = meal_line_text(m, cs, time_format)
        dishes = dish_names_in_added_order(m)
        if not line and not dishes:
            continue
        if line:
            out.append(Paragraph(f'<b>{line}</b>', s['body']))
        if dishes:
            out.append(Spacer(1, 1 * mm))
            out.append(_dish_table(dishes, s))
        out.append(Spacer(1, 3 * mm))
    if not out:
        return []
    return [_section_header([Paragraph('ADDITIONAL MEALS', s['section_title'])], [CONTENT_W])] + out + [Spacer(1, 3 * mm)]


def generate_quote_pdf(quote, signature=None):
    """
    Generate a professional quotation PDF from a Quote model instance.

    If ``signature`` (a BookingSignature) is given, an ACCEPTANCE block is stamped
    at the end — the drawn signature plus who signed, when and from where.

    Returns:
        bytes — PDF file content
    """
    settings = OrgSettings.for_org(quote.organisation)
    cs = settings.currency_symbol
    s = _styles()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=MARGIN, bottomMargin=MARGIN,
        leftMargin=MARGIN, rightMargin=MARGIN,
    )

    elements = []

    # ── Resolve org name, contact, salesperson ──
    org_name = ''
    org_contact_line = ''
    salesperson = None
    for user in [
        getattr(quote.lead, 'assigned_to', None) if quote.lead else None,
        quote.created_by,
    ]:
        if user and getattr(user, 'organisation', None):
            org_name = user.organisation.name
            break
    if quote.lead and quote.lead.assigned_to:
        salesperson = quote.lead.assigned_to
    elif quote.created_by:
        salesperson = quote.created_by

    # Build org contact line for footer
    if salesperson:
        parts = []
        name = salesperson.get_full_name() or salesperson.email
        parts.append(name)
        if salesperson.email:
            parts.append(salesperson.email)
        org_contact_line = ' | '.join(parts)

    # ── 1. Header: Org name (large, bold) + thin divider ──
    elements.append(Paragraph(org_name, s['org_name']))
    elements.append(Spacer(1, 3 * mm))
    # Thin divider line under org name
    divider = Table([['']], colWidths=[CONTENT_W])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, 0), 0),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 0),
    ]))
    elements.append(divider)
    elements.append(Spacer(1, 8 * mm))

    # ── 2. Two-column info block ──
    # Left column: "To: Customer" (person-first); the business is shown only when present.
    left_data = []
    c = quote.primary_contact
    to_name = c.name if c else (quote.account.name if quote.account_id else '—')
    left_data.append([Paragraph(f'<b>To: {to_name}</b>', s['info_header']), ''])

    if c:
        if c.phone:
            left_data.append([Paragraph('Phone:', s['info_label']), Paragraph(c.phone, s['info_value'])])
        if c.email:
            left_data.append([Paragraph('Email:', s['info_label']), Paragraph(c.email, s['info_value'])])

    if quote.account_id:
        acct = quote.account
        left_data.append([Paragraph('Business:', s['info_label']), Paragraph(acct.name, s['info_value'])])
        addr_parts = [p for p in [
            acct.billing_address_line1, acct.billing_address_line2,
            acct.billing_city, acct.billing_postcode,
        ] if p]
        if addr_parts:
            left_data.append([Paragraph('Address:', s['info_label']), Paragraph(', '.join(addr_parts), s['info_value'])])

    if quote.venue:
        venue = quote.venue
        venue_parts = [venue.name]
        addr = [p for p in [venue.address_line1, venue.city] if p]
        if addr:
            venue_parts.append(', '.join(addr))
        left_data.append([Paragraph('Venue:', s['info_label']), Paragraph(' — '.join(venue_parts), s['info_value'])])
    elif quote.venue_address:
        left_data.append([Paragraph('Venue:', s['info_label']), Paragraph(quote.venue_address, s['info_value'])])

    et_label = (
        EventTypeOption.objects.filter(value=quote.event_type, organisation=quote.organisation)
        .values_list('label', flat=True).first()
        or quote.event_type
    )
    left_data.append([Paragraph('Event Type:', s['info_label']), Paragraph(et_label, s['info_value'])])

    LEFT_COL_W = CONTENT_W * 0.52
    left_table = Table(left_data, colWidths=[LEFT_COL_W * 0.25, LEFT_COL_W * 0.75])
    left_table.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),  # "To:" header spans both cols
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
    ]))

    # Right column: Structured info table with section header
    ss_label = ''
    if quote.service_style:
        ss_label = (
            ServiceStyleOption.objects.filter(value=quote.service_style, organisation=quote.organisation)
            .values_list('label', flat=True).first()
            or quote.service_style
        )
    mt_label = ''
    if quote.meal_type:
        mt_label = (
            MealTypeOption.objects.filter(value=quote.meal_type, organisation=quote.organisation)
            .values_list('label', flat=True).first()
            or quote.meal_type
        )

    RIGHT_COL_W = CONTENT_W * 0.48
    right_header = _section_header(
        [Paragraph('QUOTATION DETAILS', s['section_title'])],
        [RIGHT_COL_W],
    )

    guests_text = str(quote.guest_count)
    if quote.gents or quote.ladies:
        guests_text += f' ({quote.gents} gents / {quote.ladies} ladies)'
    right_rows = [
        ['Quote Date:', quote.created_at.strftime('%d %B %Y')],
        ['Quotation #:', f'Q-{quote.pk}'],
        ['Customer ID:', str(quote.primary_contact_id or quote.account_id or quote.pk)],
        ['No. of Guests:', guests_text],
        ['Event Date:', quote.event_date.strftime('%d %B %Y')],
        ['Event Day:', quote.event_date.strftime('%A')],
    ]
    if quote.booking_date:
        right_rows.append(['Booking Date:', quote.booking_date.strftime('%d %B %Y')])
    if mt_label:
        right_rows.append(['Meal Type:', mt_label])
    if ss_label:
        right_rows.append(['Service Style:', ss_label])
    if quote.valid_until:
        right_rows.append(['Valid Until:', quote.valid_until.strftime('%d %B %Y')])

    right_info_data = [
        [Paragraph(r[0], s['info_label']), Paragraph(r[1], s['info_value'])]
        for r in right_rows
    ]
    right_info_table = Table(right_info_data, colWidths=[RIGHT_COL_W * 0.45, RIGHT_COL_W * 0.55])
    right_info_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('LINEBELOW', (0, 0), (-1, -2), 0.25, BORDER_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.25, BORDER_LIGHT),
        ('ROUNDEDCORNERS', [0, 0, 3, 3]),
    ]))

    # Combine right header + right info into a single flowable list via nested table
    right_combined_data = [[right_header], [right_info_table]]
    right_combined = Table(right_combined_data, colWidths=[RIGHT_COL_W])
    right_combined.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))

    # Outer two-column layout
    info_outer = Table([[left_table, right_combined]], colWidths=[LEFT_COL_W, RIGHT_COL_W])
    info_outer.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(info_outer)
    elements.append(Spacer(1, 10 * mm))

    # Timeline (setup / arrival / meal / end) — above the menu, mirroring the form.
    timeline_items = [
        ('Setup', quote.setup_time),
        ('Guest Arrival', quote.guest_arrival_time),
        ('Meal', quote.meal_time),
        ('End', quote.end_time),
    ]
    timeline_rows = [
        [Paragraph(f'{label} Time:', s['info_label']),
         Paragraph(dt.strftime(_dt_fmt(settings.time_format)), s['info_value'])]
        for label, dt in timeline_items if dt
    ]
    if timeline_rows:
        elements.append(_section_header([Paragraph('TIMELINE', s['section_title'])], [CONTENT_W]))
        tl_table = Table(timeline_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        tl_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(tl_table)
        elements.append(Spacer(1, 6 * mm))

    # ── 3. Menu Items Table (2-column layout with summary row) ──
    dish_names = dish_names_in_added_order(quote)
    has_food_total = quote.food_total and quote.food_total > 0

    ADDON_COL_WIDTHS = [CONTENT_W * 0.18, CONTENT_W * 0.42, CONTENT_W * 0.20, CONTENT_W * 0.20]

    if dish_names:
        elements.append(_section_header([Paragraph('MENU ITEMS', s['section_title'])], [CONTENT_W]))
        elements.append(_dish_table(dish_names, s))
        if not has_food_total:
            elements.append(Spacer(1, 6 * mm))

    # Food/menu summary — the MAIN meal line (shown even with no dish list, so
    # food_total never sits silently in the subtotal — the Q-59 bug).
    main_food = (quote.price_per_head or 0) * quote.guest_count
    food_line = food_summary_text(quote.price_per_head, quote.guest_count, main_food, cs)
    if food_line:
        if dish_names:
            elements.append(Spacer(1, 3 * mm))
        else:
            elements.append(_section_header([Paragraph('FOOD / MENU', s['section_title'])], [CONTENT_W]))
        elements.append(Paragraph(f'<b>{food_line}</b>', s['body']))
        elements.append(Spacer(1, 6 * mm))

    # Additional meals — a summary line + that meal's own menu as a table.
    elements.extend(_meal_flowables(quote, cs, s, settings.time_format))

    # ── 4. Add-ons / Line Items ──
    line_items = list(quote.line_items.all())
    if line_items:
        addons_header = _section_header([
            Paragraph('CATEGORY', s['section_title']),
            Paragraph('ADD-ONS / ADDITIONAL ITEMS', s['section_title']),
            Paragraph('RATE', s['section_title_right']),
            Paragraph('AMOUNT', s['section_title_right']),
        ], ADDON_COL_WIDTHS)
        elements.append(addons_header)

        addon_rows = []
        for item in line_items:
            cat, desc, rate, amount = addon_cells(item, cs)

            amount_style = s['body_right']
            if item.category == 'discount':
                amount_style = ParagraphStyle(
                    'Discount', parent=s['body_right'],
                    textColor=colors.HexColor('#DC2626'),
                )

            addon_rows.append([
                Paragraph(cat, s['body']),
                Paragraph(desc, s['body']),
                Paragraph(rate, s['body_right']),
                Paragraph(amount, amount_style),
            ])

        addon_table = Table(addon_rows, colWidths=ADDON_COL_WIDTHS)
        addon_style = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]
        # Thin row separators
        for i in range(len(addon_rows)):
            addon_style.append(('LINEBELOW', (0, i), (-1, i), 0.25, BORDER_LIGHT))
        addon_table.setStyle(TableStyle(addon_style))
        elements.append(addon_table)
        elements.append(Spacer(1, 6 * mm))

    # ── 5. Notes (customer-visible only; internal notes are never in the PDF) ──
    if quote.notes:
        elements.append(Spacer(1, 2 * mm))
        elements.append(Paragraph('<b>Notes:</b>', s['body_bold']))
        elements.append(Paragraph(quote.notes, s['note']))
        elements.append(Spacer(1, 6 * mm))

    # ── 6. Totals block (right-aligned) ──
    tax_pct = (quote.tax_rate * 100).quantize(Decimal('1'))
    TOTALS_LABEL_W = 110
    TOTALS_VALUE_W = 120
    TOTALS_W = TOTALS_LABEL_W + TOTALS_VALUE_W

    tax_label = settings.tax_label or 'Tax'
    totals_rows = [
        [Paragraph('Sub Total', s['totals_label']), Paragraph(_fmt(quote.subtotal, cs), s['totals_value'])],
        [Paragraph('TOTAL', s['body_bold_right']), Paragraph(_fmt(quote.subtotal, cs), s['body_bold_right'])],
        [Paragraph(f'{tax_label} Rate', s['totals_label']), Paragraph(f'{tax_pct}%', s['totals_value'])],
        [Paragraph(f'{tax_label} Amount', s['totals_label']), Paragraph(_fmt(quote.tax_amount, cs), s['totals_value'])],
    ]
    totals_inner = Table(totals_rows, colWidths=[TOTALS_LABEL_W, TOTALS_VALUE_W])
    totals_inner.setStyle(TableStyle([
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, 0), (-1, -2), 0.25, BORDER_LIGHT),
        ('BOX', (0, 0), (-1, -1), 0.25, BORDER_LIGHT),
        ('ROUNDEDCORNERS', [3, 3, 0, 0]),
    ]))

    # Grand total row (dark background — only dark bar in PDF)
    grand_row = [[Paragraph('GRAND TOTAL', s['grand_label']), Paragraph(_fmt(quote.total, cs), s['grand_value'])]]
    grand_table = Table(grand_row, colWidths=[TOTALS_LABEL_W, TOTALS_VALUE_W])
    grand_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), DARK),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('ROUNDEDCORNERS', [0, 0, 3, 3]),
    ]))

    spacer_w = CONTENT_W - TOTALS_W
    outer_totals = Table(
        [[None, totals_inner], [None, grand_table]],
        colWidths=[spacer_w, TOTALS_W],
    )
    outer_totals.setStyle(TableStyle([
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    elements.append(outer_totals)

    # ── 7. Terms & Conditions (page 2 if present) ──
    terms_text = settings.quotation_terms.strip() if settings.quotation_terms else ''
    if terms_text:
        elements.append(PageBreak())

        # T&C header
        elements.append(_section_header(
            [Paragraph('TERMS & CONDITIONS', s['section_title'])],
            [CONTENT_W],
        ))
        elements.append(Spacer(1, 6 * mm))

        # Render each paragraph of the terms
        for para in terms_text.split('\n'):
            para = para.strip()
            if para:
                elements.append(Paragraph(para, s['note']))
            else:
                elements.append(Spacer(1, 2 * mm))

    elements += _acceptance_block(signature, s)

    doc.build(elements)
    return buf.getvalue()


def _choice_label(model, value, org):
    if not value:
        return ''
    return (model.objects.filter(value=value, organisation=org)
            .values_list('label', flat=True).first() or value)


def generate_event_pdf(event, signature=None):
    """Generate an EVENT FUNCTION SHEET PDF for the ops/kitchen team from an Event
    instance. Shares the quote PDF's styles + food/meal/add-on helpers, but leads
    with the operational detail (timeline, guest counts, menu, kitchen/banquet/
    setup instructions) rather than sales/pricing. If ``signature`` is given, an
    ACCEPTANCE block is stamped at the end. Returns bytes.
    """
    settings = OrgSettings.for_org(event.organisation)
    cs = settings.currency_symbol
    s = _styles()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=MARGIN, bottomMargin=MARGIN,
        leftMargin=MARGIN, rightMargin=MARGIN,
    )
    elements = []

    org_name = event.organisation.name if event.organisation_id else ''

    # ── Header: org name + "EVENT FUNCTION SHEET" title + divider ──
    elements.append(Paragraph(org_name, s['org_name']))
    elements.append(Spacer(1, 1 * mm))
    elements.append(Paragraph('EVENT FUNCTION SHEET', s['section_heading']))
    divider = Table([['']], colWidths=[CONTENT_W])
    divider.setStyle(TableStyle([
        ('LINEBELOW', (0, 0), (-1, 0), 0.5, BORDER_LIGHT),
        ('TOPPADDING', (0, 0), (-1, 0), 0),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 0),
    ]))
    elements.append(divider)
    elements.append(Spacer(1, 8 * mm))

    # ── Two-column info block: customer/venue (left) + event details (right) ──
    left_data = []
    c = event.primary_contact
    to_name = c.name if c else (event.account.name if event.account_id else '—')
    left_data.append([Paragraph(f'<b>{event.name or to_name}</b>', s['info_header']), ''])
    left_data.append([Paragraph('Customer:', s['info_label']), Paragraph(to_name, s['info_value'])])
    if c and c.phone:
        left_data.append([Paragraph('Phone:', s['info_label']), Paragraph(c.phone, s['info_value'])])
    if event.account_id:
        left_data.append([Paragraph('Business:', s['info_label']), Paragraph(event.account.name, s['info_value'])])
    if event.venue:
        venue = event.venue
        venue_parts = [venue.name]
        addr = [p for p in [venue.address_line1, venue.city] if p]
        if addr:
            venue_parts.append(', '.join(addr))
        left_data.append([Paragraph('Venue:', s['info_label']), Paragraph(' — '.join(venue_parts), s['info_value'])])
    elif event.venue_address:
        left_data.append([Paragraph('Venue:', s['info_label']), Paragraph(event.venue_address, s['info_value'])])
    left_data.append([Paragraph('Event Type:', s['info_label']),
                      Paragraph(_choice_label(EventTypeOption, event.event_type, event.organisation), s['info_value'])])

    LEFT_COL_W = CONTENT_W * 0.52
    left_table = Table(left_data, colWidths=[LEFT_COL_W * 0.28, LEFT_COL_W * 0.72])
    left_table.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2),
    ]))

    guests_text = str(event.guest_count)
    if event.has_guest_split:
        guests_text += f' ({event.gents} gents / {event.ladies} ladies)'
    right_rows = [
        ['Event Date:', event.event_date.strftime('%d %B %Y')],
        ['Event Day:', event.event_date.strftime('%A')],
        ['Status:', event.get_status_display()],
        ['No. of Guests:', guests_text],
    ]
    mt = _choice_label(MealTypeOption, event.meal_type, event.organisation)
    if mt:
        right_rows.append(['Meal Type:', mt])
    ss = _choice_label(ServiceStyleOption, event.service_style, event.organisation)
    if ss:
        right_rows.append(['Service Style:', ss])
    if event.guaranteed_count is not None:
        right_rows.append(['Guaranteed Count:', str(event.guaranteed_count)])
    if event.final_count is not None:
        right_rows.append(['Final Count:', str(event.final_count)])
    if event.final_count_due:
        right_rows.append(['Final Count Due:', event.final_count_due.strftime('%d %B %Y')])

    RIGHT_COL_W = CONTENT_W * 0.48
    right_header = _section_header([Paragraph('EVENT DETAILS', s['section_title'])], [RIGHT_COL_W])
    right_info = Table(
        [[Paragraph(r[0], s['info_label']), Paragraph(r[1], s['info_value'])] for r in right_rows],
        colWidths=[RIGHT_COL_W * 0.45, RIGHT_COL_W * 0.55],
    )
    right_info.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (-1, -1), BG_SUBTLE),
    ]))
    right_col = [right_header, right_info]

    info_block = Table(
        [[left_table, Spacer(1, 1), Table([[rc] for rc in right_col], colWidths=[RIGHT_COL_W])]],
        colWidths=[LEFT_COL_W, CONTENT_W * 0.02 - 2, RIGHT_COL_W - CONTENT_W * 0.02 + 2],
    )
    info_block.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(info_block)
    elements.append(Spacer(1, 8 * mm))

    # ── Timeline ──
    timeline_items = [
        ('Setup', event.setup_time), ('Guest Arrival', event.guest_arrival_time),
        ('Meal', event.meal_time), ('End', event.end_time),
    ]
    timeline_rows = [
        [Paragraph(f'{label} Time:', s['info_label']),
         Paragraph(dt.strftime(_dt_fmt(settings.time_format)), s['info_value'])]
        for label, dt in timeline_items if dt
    ]
    if timeline_rows:
        elements.append(_section_header([Paragraph('TIMELINE', s['section_title'])], [CONTENT_W]))
        tl_table = Table(timeline_rows, colWidths=[CONTENT_W * 0.25, CONTENT_W * 0.75])
        tl_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        elements.append(tl_table)
        elements.append(Spacer(1, 6 * mm))

    # ── Menu items + main food line ──
    dish_names = dish_names_in_added_order(event)
    if dish_names:
        elements.append(_section_header([Paragraph('MENU ITEMS', s['section_title'])], [CONTENT_W]))
        elements.append(_dish_table(dish_names, s))
        elements.append(Spacer(1, 3 * mm))

    main_food = (event.price_per_head or 0) * event.guest_count
    food_line = food_summary_text(event.price_per_head, event.guest_count, main_food, cs)
    if food_line:
        if not dish_names:
            elements.append(_section_header([Paragraph('FOOD / MENU', s['section_title'])], [CONTENT_W]))
        elements.append(Paragraph(f'<b>{food_line}</b>', s['body']))
        elements.append(Spacer(1, 6 * mm))

    # ── Additional meals — a summary line + that meal's own menu as a table. ──
    elements.extend(_meal_flowables(event, cs, s, settings.time_format))

    # ── Add-ons / additional items ──
    line_items = list(event.line_items.all())
    if line_items:
        ADDON_COL_WIDTHS = [CONTENT_W * 0.18, CONTENT_W * 0.42, CONTENT_W * 0.20, CONTENT_W * 0.20]
        elements.append(_section_header([
            Paragraph('CATEGORY', s['section_title']),
            Paragraph('ADD-ONS / ADDITIONAL ITEMS', s['section_title']),
            Paragraph('RATE', s['section_title_right']),
            Paragraph('AMOUNT', s['section_title_right']),
        ], ADDON_COL_WIDTHS))
        addon_rows = []
        for item in line_items:
            cat, desc, rate, amount = addon_cells(item, cs)
            amount_style = s['body_right']
            if item.category == 'discount':
                amount_style = ParagraphStyle('Discount', parent=s['body_right'], textColor=colors.HexColor('#DC2626'))
            addon_rows.append([
                Paragraph(cat, s['body']), Paragraph(desc, s['body']),
                Paragraph(rate, s['body_right']), Paragraph(amount, amount_style),
            ])
        addon_table = Table(addon_rows, colWidths=ADDON_COL_WIDTHS)
        addon_style = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3), ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]
        for i in range(len(addon_rows)):
            addon_style.append(('LINEBELOW', (0, i), (-1, i), 0.25, BORDER_LIGHT))
        addon_table.setStyle(TableStyle(addon_style))
        elements.append(addon_table)
        elements.append(Spacer(1, 6 * mm))

    # ── Ops instructions (kitchen / banquet / setup) ──
    for title, text in [
        ('KITCHEN INSTRUCTIONS', event.kitchen_instructions),
        ('BANQUET INSTRUCTIONS', event.banquet_instructions),
        ('SETUP INSTRUCTIONS', event.setup_instructions),
    ]:
        if text and text.strip():
            elements.append(_section_header([Paragraph(title, s['section_title'])], [CONTENT_W]))
            elements.append(Spacer(1, 2 * mm))
            for para in text.split('\n'):
                if para.strip():
                    elements.append(Paragraph(para.strip(), s['note']))
            elements.append(Spacer(1, 6 * mm))

    elements += _acceptance_block(signature, s)

    doc.build(elements)
    return buf.getvalue()
