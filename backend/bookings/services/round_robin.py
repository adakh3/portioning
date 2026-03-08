from django.contrib.contenttypes.models import ContentType
from django.db.models import Count, Q

from bookings.models import Lead, ProductLine
from bookings.models.activity import ActivityLog


def run_round_robin(triggered_by_user):
    """
    Auto-assign unassigned, non-terminal leads to salespeople by product line.
    Uses count-based fairness: the salesperson with the fewest active leads
    in that product line gets the next lead.

    Returns dict with assigned, skipped_no_product, skipped_no_staff counts.
    """
    terminal_statuses = ['won', 'lost']

    # All unassigned, non-terminal leads
    unassigned = Lead.objects.filter(
        assigned_to__isnull=True,
    ).exclude(
        status__in=terminal_statuses,
    ).select_related('product').order_by('created_at')

    assigned_count = 0
    skipped_no_product = 0
    skipped_no_staff = 0
    activity_logs = []
    ct = ContentType.objects.get_for_model(Lead)

    # Group leads by product line
    leads_by_product = {}
    for lead in unassigned:
        if lead.product_id is None:
            skipped_no_product += 1
            continue
        leads_by_product.setdefault(lead.product_id, []).append(lead)

    for product_id, leads in leads_by_product.items():
        # Get active salespeople for this product line
        salespeople = list(
            ProductLine.objects.get(pk=product_id)
            .salespeople
            .filter(is_active=True)
            .annotate(
                active_lead_count=Count(
                    'assigned_leads',
                    filter=Q(assigned_leads__product_id=product_id)
                    & ~Q(assigned_leads__status__in=terminal_statuses),
                )
            )
            .order_by('active_lead_count', 'pk')
        )

        if not salespeople:
            skipped_no_staff += len(leads)
            continue

        for i, lead in enumerate(leads):
            sp = salespeople[i % len(salespeople)]
            lead.assigned_to = sp
            lead.save(update_fields=['assigned_to'])
            assigned_count += 1

            sp_name = f"{sp.first_name} {sp.last_name}".strip() or sp.email
            activity_logs.append(ActivityLog(
                content_type=ct,
                object_id=lead.pk,
                action='updated',
                field_name='assigned_to',
                old_value='',
                new_value=str(sp.pk),
                description=f"Auto-assigned to {sp_name} via round-robin",
                user=triggered_by_user,
            ))

    if activity_logs:
        ActivityLog.objects.bulk_create(activity_logs)

    return {
        'assigned': assigned_count,
        'skipped_no_product': skipped_no_product,
        'skipped_no_staff': skipped_no_staff,
    }
