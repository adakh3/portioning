"""Generate kitchen prep sheet PDFs from calculation results."""
import io
from datetime import date

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle


def generate_portion_pdf(result, menu_name, guests, event_date=None):
    """
    Generate a kitchen prep sheet PDF from calculation results.

    Args:
        result: dict from calculate_portions() — portions, totals, warnings, adjustments
        menu_name: str — menu or event name
        guests: dict — {'gents': int, 'ladies': int}
        event_date: str or None — event date

    Returns:
        bytes — PDF file content
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=20 * mm,
        bottomMargin=15 * mm,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'SheetTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        'SheetSubtitle',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor('#444444'),
        spaceAfter=2,
    )
    section_style = ParagraphStyle(
        'SectionHeader',
        parent=styles['Heading2'],
        fontSize=13,
        spaceBefore=14,
        spaceAfter=6,
        textColor=colors.HexColor('#222222'),
    )
    note_style = ParagraphStyle(
        'Note',
        parent=styles['Normal'],
        fontSize=9,
        leftIndent=10,
        spaceAfter=2,
    )

    elements = []

    # Header
    elements.append(Paragraph('PORTIONING SHEET', title_style))
    elements.append(Paragraph(f'Menu: {menu_name}', subtitle_style))
    gents = guests.get('gents', 0)
    ladies = guests.get('ladies', 0)
    total_guests = gents + ladies
    elements.append(Paragraph(
        f'Guests: {gents} gents + {ladies} ladies ({total_guests} total)',
        subtitle_style,
    ))
    display_date = event_date or date.today().isoformat()
    elements.append(Paragraph(f'Date: {display_date}', subtitle_style))
    elements.append(Spacer(1, 8 * mm))

    # Group portions by pool
    portions = result.get('portions', [])
    pools = _group_by_pool(portions)

    pool_order = ['protein', 'accompaniment', 'dessert', 'service']
    pool_labels = {
        'protein': 'PROTEIN',
        'accompaniment': 'ACCOMPANIMENT',
        'dessert': 'DESSERT',
        'service': 'SERVICE',
    }

    for pool_key in pool_order:
        pool_portions = pools.get(pool_key, [])
        if not pool_portions:
            continue

        label = pool_labels.get(pool_key, pool_key.upper())
        elements.append(Paragraph(label, section_style))

        is_service = pool_key == 'service'
        table_data, col_widths = _build_pool_table(pool_portions, is_service)
        table = Table(table_data, colWidths=col_widths)
        table.setStyle(_table_style(len(table_data)))
        elements.append(table)

    # Grand totals
    totals = result.get('totals', {})
    elements.append(Spacer(1, 6 * mm))
    elements.append(Paragraph('TOTALS', section_style))

    total_data = [
        ['Food per gent', f"{totals.get('food_per_gent_grams', 0):.0f}g"],
        ['Food per lady', f"{totals.get('food_per_lady_grams', 0):.0f}g"],
        ['Food per person (avg)', f"{totals.get('food_per_person_grams', 0):.0f}g"],
        ['Protein per person', f"{totals.get('protein_per_person_grams', 0):.0f}g"],
        ['Total food weight', f"{totals.get('total_food_weight_grams', 0) / 1000:.1f} kg"],
        ['Total cost', f"\u00a3{totals.get('total_cost', 0):.2f}"],
    ]
    total_table = Table(total_data, colWidths=[130, 100])
    total_table.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
    ]))
    elements.append(total_table)

    # Notes (adjustments + warnings)
    adjustments = result.get('adjustments_applied', [])
    warnings = result.get('warnings', [])
    notes = adjustments + warnings
    if notes:
        elements.append(Spacer(1, 6 * mm))
        elements.append(Paragraph('NOTES', section_style))
        for note in notes:
            elements.append(Paragraph(f'\u2022 {note}', note_style))

    doc.build(elements)
    return buf.getvalue()


def _group_by_pool(portions):
    """Group portion results by pool name."""
    pools = {}
    for p in portions:
        pool = p.get('pool', 'other')
        pools.setdefault(pool, []).append(p)
    return pools


def _build_pool_table(pool_portions, is_service=False):
    """Build table data and column widths for a pool section."""
    if is_service:
        header = ['Dish', 'Category', 'Per Gent', 'Per Lady', 'Total']
    else:
        header = ['Dish', 'Category', 'Per Gent', 'Per Lady', 'Total (kg)']

    rows = [header]
    subtotal_gent = 0.0
    subtotal_lady = 0.0
    subtotal_total = 0.0

    for p in pool_portions:
        unit = p.get('unit', 'grams')
        gent_val = p.get('grams_per_gent', 0)
        lady_val = p.get('grams_per_lady', 0)
        total_val = p.get('total_grams', 0)

        if unit == 'qty':
            gent_str = f"{gent_val:.0f} qty"
            lady_str = f"{lady_val:.0f} qty"
            total_str = f"{total_val:.0f} qty"
        else:
            gent_str = f"{gent_val:.0f}g"
            lady_str = f"{lady_val:.0f}g"
            total_str = f"{total_val / 1000:.1f}"

        rows.append([
            p.get('dish_name', ''),
            p.get('category', ''),
            gent_str,
            lady_str,
            total_str,
        ])

        subtotal_gent += gent_val
        subtotal_lady += lady_val
        subtotal_total += total_val

    # Subtotal row
    if is_service:
        rows.append(['Subtotal', '', f'{subtotal_gent:.0f}', f'{subtotal_lady:.0f}', f'{subtotal_total:.0f}'])
    else:
        rows.append([
            'Subtotal', '',
            f'{subtotal_gent:.0f}g',
            f'{subtotal_lady:.0f}g',
            f'{subtotal_total / 1000:.1f}',
        ])

    col_widths = [150, 100, 70, 70, 70]
    return rows, col_widths


def _table_style(num_rows):
    """Return a clean monochrome TableStyle."""
    return TableStyle([
        # Header row
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#333333')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 9),
        # Body
        ('FONTSIZE', (0, 1), (-1, -1), 9),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        # Subtotal row (last row)
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('LINEABOVE', (0, -1), (-1, -1), 1, colors.black),
        # Grid
        ('LINEBELOW', (0, 0), (-1, 0), 1, colors.black),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F5F5F5')]),
        # Padding
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        # Alignment
        ('ALIGN', (2, 0), (-1, -1), 'RIGHT'),
    ])
