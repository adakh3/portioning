"""Generate professional quotation PDFs from Quote objects."""
import io
from decimal import Decimal

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from bookings.models.settings import SiteSettings


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


def generate_quote_pdf(quote):
    """
    Generate a professional quotation PDF from a Quote model instance.

    Args:
        quote: Quote model instance (with line_items prefetched)

    Returns:
        bytes — PDF file content
    """
    settings = SiteSettings.load()
    cs = settings.currency_symbol

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'QuoteTitle', parent=styles['Heading1'],
        fontSize=20, spaceAfter=2,
    )
    subtitle_style = ParagraphStyle(
        'QuoteSubtitle', parent=styles['Normal'],
        fontSize=11, textColor=colors.HexColor('#555555'), spaceAfter=2,
    )
    section_style = ParagraphStyle(
        'SectionHeader', parent=styles['Heading2'],
        fontSize=13, spaceBefore=14, spaceAfter=6,
        textColor=colors.HexColor('#222222'),
    )
    label_style = ParagraphStyle(
        'Label', parent=styles['Normal'],
        fontSize=9, textColor=colors.HexColor('#666666'), spaceAfter=1,
    )
    value_style = ParagraphStyle(
        'Value', parent=styles['Normal'],
        fontSize=10, spaceAfter=4,
    )
    note_style = ParagraphStyle(
        'Note', parent=styles['Normal'],
        fontSize=9, textColor=colors.HexColor('#444444'), spaceAfter=2,
    )

    elements = []

    # ── Header ──
    elements.append(Paragraph('QUOTATION', title_style))
    elements.append(Paragraph(
        f'Quote #{quote.pk} v{quote.version} &mdash; {quote.get_status_display()}',
        subtitle_style,
    ))
    elements.append(Paragraph(
        f'Date: {quote.created_at.strftime("%d %B %Y")}',
        subtitle_style,
    ))
    if quote.valid_until:
        elements.append(Paragraph(
            f'Valid until: {quote.valid_until.strftime("%d %B %Y")}',
            subtitle_style,
        ))
    elements.append(Spacer(1, 8 * mm))

    # ── Customer Details ──
    elements.append(Paragraph('CUSTOMER', section_style))
    elements.append(Paragraph('Account', label_style))
    elements.append(Paragraph(quote.account.name, value_style))

    if quote.primary_contact:
        contact = quote.primary_contact
        elements.append(Paragraph('Contact', label_style))
        contact_parts = [contact.name]
        if contact.email:
            contact_parts.append(contact.email)
        if contact.phone:
            contact_parts.append(contact.phone)
        elements.append(Paragraph(' &bull; '.join(contact_parts), value_style))

    # Billing address
    acct = quote.account
    addr_parts = [p for p in [
        acct.billing_address_line1, acct.billing_address_line2,
        acct.billing_city, acct.billing_postcode, acct.billing_country,
    ] if p]
    if addr_parts:
        elements.append(Paragraph('Address', label_style))
        elements.append(Paragraph(', '.join(addr_parts), value_style))

    elements.append(Spacer(1, 4 * mm))

    # ── Event Details ──
    elements.append(Paragraph('EVENT DETAILS', section_style))

    event_data = [
        ['Date', str(quote.event_date.strftime('%d %B %Y'))],
        ['Guest Count', str(quote.guest_count)],
        ['Event Type', quote.get_event_type_display()],
    ]
    if quote.service_style:
        event_data.append(['Service Style', quote.get_service_style_display()])

    # Venue
    if quote.venue:
        venue = quote.venue
        venue_parts = [venue.name]
        addr = [p for p in [
            venue.address_line1, venue.address_line2,
            venue.city, venue.postcode,
        ] if p]
        if addr:
            venue_parts.append(', '.join(addr))
        event_data.append(['Venue', ' — '.join(venue_parts)])
    elif quote.venue_address:
        event_data.append(['Venue', quote.venue_address])

    event_table = Table(event_data, colWidths=[100, 360])
    event_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#555555')),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    elements.append(event_table)
    elements.append(Spacer(1, 4 * mm))

    # ── Menu ──
    dish_names = list(quote.dishes.values_list('name', flat=True))
    if dish_names:
        elements.append(Paragraph('MENU', section_style))
        for name in dish_names:
            elements.append(Paragraph(f'&bull; {name}', note_style))
        elements.append(Spacer(1, 4 * mm))

    # ── Line Items ──
    line_items = list(quote.line_items.all())
    has_food_total = quote.food_total > 0
    has_items = len(line_items) > 0

    if has_food_total or has_items:
        elements.append(Paragraph('PRICING', section_style))

        table_data = [['Category', 'Description', 'Qty', 'Unit', 'Unit Price', 'Total']]

        # Food cost row (price per head)
        if has_food_total:
            table_data.append([
                'Food',
                f'Menu ({cs}{quote.price_per_head} per head x {quote.guest_count} guests)',
                str(quote.guest_count),
                'Per Guest',
                f'{cs}{quote.price_per_head}',
                f'{cs}{quote.food_total}',
            ])

        # Line items
        for item in line_items:
            table_data.append([
                CATEGORY_LABELS.get(item.category, item.category),
                item.description,
                str(item.quantity),
                UNIT_LABELS.get(item.unit, item.unit),
                f'{cs}{item.unit_price}',
                f'{cs}{item.line_total}',
            ])

        col_widths = [60, 185, 40, 60, 65, 65]
        table = Table(table_data, colWidths=col_widths)
        table.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#333333')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            # Body
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            # Grid
            ('LINEBELOW', (0, 0), (-1, 0), 1, colors.black),
            ('LINEBELOW', (0, -1), (-1, -1), 0.5, colors.HexColor('#CCCCCC')),
            # Padding
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            # Alignment
            ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
        ]))
        elements.append(table)
        elements.append(Spacer(1, 4 * mm))

    # ── Totals ──
    elements.append(Paragraph('TOTALS', section_style))
    tax_pct = (quote.tax_rate * 100).quantize(Decimal('1'))

    totals_data = [
        ['Subtotal', f'{cs}{quote.subtotal}'],
        [f'VAT ({tax_pct}%)', f'{cs}{quote.tax_amount}'],
    ]
    totals_table = Table(totals_data, colWidths=[380, 95])
    totals_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.HexColor('#555555')),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    elements.append(totals_table)

    # Grand total
    grand_total_data = [['TOTAL', f'{cs}{quote.total}']]
    grand_total_table = Table(grand_total_data, colWidths=[380, 95])
    grand_total_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 14),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('LINEABOVE', (0, 0), (-1, 0), 2, colors.black),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(grand_total_table)

    # ── Notes ──
    if quote.notes:
        elements.append(Spacer(1, 6 * mm))
        elements.append(Paragraph('NOTES', section_style))
        elements.append(Paragraph(quote.notes, note_style))

    doc.build(elements)
    return buf.getvalue()
