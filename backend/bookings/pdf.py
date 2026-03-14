"""Generate professional quotation PDFs matching industry-standard catering format."""
import io
import math
from decimal import Decimal

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, KeepTogether,
    PageBreak,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from bookings.models.settings import OrgSettings
from bookings.models.choices import EventTypeOption, ServiceStyleOption


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


def _fmt(value, cs='£'):
    """Format a Decimal as a currency string with thousand separators."""
    return f'{cs}{value:,.2f}'


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
            fontName='Helvetica-Bold', fontSize=12,
            textColor=WHITE, leading=14, alignment=TA_RIGHT,
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


def generate_quote_pdf(quote):
    """
    Generate a professional quotation PDF from a Quote model instance.

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
    # Left column: "To: Customer" with contact info
    cust = quote.customer
    left_data = []
    left_data.append([Paragraph(f'<b>To: {cust.display_name}</b>', s['info_header']), ''])

    if cust.name and cust.customer_type == 'business':
        left_data.append([Paragraph('Contact:', s['info_label']), Paragraph(cust.name, s['info_value'])])
    if cust.phone:
        left_data.append([Paragraph('Phone:', s['info_label']), Paragraph(cust.phone, s['info_value'])])
    if cust.email:
        left_data.append([Paragraph('Email:', s['info_label']), Paragraph(cust.email, s['info_value'])])

    addr_parts = [p for p in [
        cust.billing_address_line1, cust.billing_address_line2,
        cust.billing_city, cust.billing_postcode,
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

    RIGHT_COL_W = CONTENT_W * 0.48
    right_header = _section_header(
        [Paragraph('QUOTATION DETAILS', s['section_title'])],
        [RIGHT_COL_W],
    )

    right_rows = [
        ['Booking Date:', quote.created_at.strftime('%d %B %Y')],
        ['Quotation #:', f'Q-{quote.pk}'],
        ['Customer ID:', str(cust.pk)],
        ['No. of Guests:', str(quote.guest_count)],
        ['Event Date:', quote.event_date.strftime('%d %B %Y')],
        ['Event Day:', quote.event_date.strftime('%A')],
    ]
    if ss_label:
        right_rows.append(['Service Style:', ss_label])

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

    # ── 3. Menu Items Table (2-column layout with summary row) ──
    dish_names = list(quote.dishes.values_list('name', flat=True))
    has_food_total = quote.food_total and quote.food_total > 0

    ITEM_COL_WIDTHS = [CONTENT_W * 0.60, CONTENT_W * 0.20, CONTENT_W * 0.20]
    MENU_COL_W = CONTENT_W * 0.50

    if dish_names and has_food_total:
        menu_header = _section_header([
            Paragraph('MENU ITEMS', s['section_title']),
        ], [CONTENT_W])
        elements.append(menu_header)

        # Build 2-column dish list
        half = math.ceil(len(dish_names) / 2)
        col1 = dish_names[:half]
        col2 = dish_names[half:]
        menu_rows = []
        for i in range(half):
            left = Paragraph(col1[i], s['body'])
            right = Paragraph(col2[i], s['body']) if i < len(col2) else Paragraph('', s['body'])
            menu_rows.append([left, right])

        menu_table = Table(menu_rows, colWidths=[MENU_COL_W, MENU_COL_W])
        menu_style = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ]
        # Thin row separators (Stripe-style)
        for i in range(len(menu_rows)):
            menu_style.append(('LINEBELOW', (0, i), (-1, i), 0.25, BORDER_LIGHT))
        menu_table.setStyle(TableStyle(menu_style))
        elements.append(menu_table)

        # Bold summary line below the menu
        elements.append(Spacer(1, 3 * mm))
        elements.append(Paragraph(
            f'<b>{_fmt(quote.price_per_head, cs)} per head × {quote.guest_count} guests = {_fmt(quote.food_total, cs)}</b>',
            s['body'],
        ))
        elements.append(Spacer(1, 6 * mm))

    # ── 4. Add-ons / Line Items ──
    line_items = list(quote.line_items.all())
    if line_items:
        addons_header = _section_header([
            Paragraph('ADD-ONS / ADDITIONAL ITEMS', s['section_title']),
            Paragraph('RATE', s['section_title_right']),
            Paragraph('AMOUNT', s['section_title_right']),
        ], ITEM_COL_WIDTHS)
        elements.append(addons_header)

        addon_rows = []
        for item in line_items:
            cat = CATEGORY_LABELS.get(item.category, item.category)
            unit = UNIT_LABELS.get(item.unit, item.unit)
            desc = item.description
            if item.quantity != 1:
                desc += f'  ({item.quantity} × {unit})'

            amount_style = s['body_right']
            if item.category == 'discount':
                amount_style = ParagraphStyle(
                    'Discount', parent=s['body_right'],
                    textColor=colors.HexColor('#DC2626'),
                )

            addon_rows.append([
                Paragraph(desc, s['body']),
                Paragraph(_fmt(item.unit_price, cs), s['body_right']),
                Paragraph(_fmt(item.line_total, cs), amount_style),
            ])

        addon_table = Table(addon_rows, colWidths=ITEM_COL_WIDTHS)
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

    # ── 5. Notes ──
    if quote.notes:
        elements.append(Spacer(1, 2 * mm))
        elements.append(Paragraph('<b>Notes:</b>', s['body_bold']))
        elements.append(Paragraph(quote.notes, s['note']))
        elements.append(Spacer(1, 6 * mm))

    # ── 6. Totals block (right-aligned) ──
    tax_pct = (quote.tax_rate * 100).quantize(Decimal('1'))
    TOTALS_LABEL_W = 110
    TOTALS_VALUE_W = 100
    TOTALS_W = TOTALS_LABEL_W + TOTALS_VALUE_W

    totals_rows = [
        [Paragraph('Sub Total', s['totals_label']), Paragraph(_fmt(quote.subtotal, cs), s['totals_value'])],
        [Paragraph('TOTAL', s['body_bold_right']), Paragraph(_fmt(quote.subtotal, cs), s['body_bold_right'])],
        [Paragraph(f'Sales Tax Rate', s['totals_label']), Paragraph(f'{tax_pct}%', s['totals_value'])],
        [Paragraph('Sales Tax Amount', s['totals_label']), Paragraph(_fmt(quote.tax_amount, cs), s['totals_value'])],
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

        elements.append(Spacer(1, 8 * mm))

        # Contact line
        if org_contact_line:
            elements.append(Paragraph(
                f'If you have any questions about this quotation, please contact: {org_contact_line}',
                s['note_grey'],
            ))
            elements.append(Spacer(1, 10 * mm))

        # ── 8. Signature block ──
        sig_line = '_' * 35
        rep_name = ''
        if salesperson:
            rep_name = salesperson.get_full_name() or salesperson.email

        sig_left = [
            [Paragraph('<b>Customer</b>', s['sig_label'])],
            [Spacer(1, 6 * mm)],
            [Paragraph(f'Name: {sig_line}', s['sig_label'])],
            [Spacer(1, 4 * mm)],
            [Paragraph(f'CNIC: {sig_line}', s['sig_label'])],
            [Spacer(1, 4 * mm)],
            [Paragraph(f'Signature: {sig_line}', s['sig_label'])],
        ]
        sig_right = [
            [Paragraph('<b>Representative</b>', s['sig_label'])],
            [Spacer(1, 6 * mm)],
            [Paragraph(f'Name: {rep_name}', s['sig_label'])],
            [Spacer(1, 4 * mm)],
            [Paragraph(f'Signature: {sig_line}', s['sig_label'])],
        ]

        sig_left_table = Table(sig_left, colWidths=[CONTENT_W * 0.48])
        sig_left_table.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        sig_right_table = Table(sig_right, colWidths=[CONTENT_W * 0.48])
        sig_right_table.setStyle(TableStyle([
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))

        sig_outer = Table([[sig_left_table, sig_right_table]], colWidths=[CONTENT_W * 0.50, CONTENT_W * 0.50])
        sig_outer.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(sig_outer)

    doc.build(elements)
    return buf.getvalue()
