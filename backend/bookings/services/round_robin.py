from django.contrib.contenttypes.models import ContentType

from bookings.models import Lead, ProductLine
from bookings.models.activity import ActivityLog


def run_round_robin(triggered_by_user, org=None, dry_run=False):
    """
    Auto-assign unassigned, non-terminal leads to salespeople by product line.
    Uses strict round-robin: a persistent index on each ProductLine tracks
    whose turn is next, regardless of current load.

    When dry_run=True, computes assignments without saving anything.

    Returns dict with assigned, skipped_no_product, skipped_no_staff counts
    and an assignments list grouped by salesperson + product line.
    """
    terminal_statuses = ['won', 'lost']
    if org is None:
        org = triggered_by_user.organisation

    # All unassigned, non-terminal leads in this org
    unassigned = Lead.objects.filter(
        organisation=org,
        assigned_to__isnull=True,
    ).exclude(
        status__in=terminal_statuses,
    ).select_related('product').order_by('created_at')

    assigned_count = 0
    skipped_no_product = 0
    skipped_no_staff = 0
    activity_logs = []
    ct = ContentType.objects.get_for_model(Lead)

    # Track assignments per (salesperson, product_line) for preview
    assignment_counts = {}

    # Group leads by product line
    leads_by_product = {}
    for lead in unassigned:
        if lead.product_id is None:
            skipped_no_product += 1
            continue
        leads_by_product.setdefault(lead.product_id, []).append(lead)

    for product_id, leads in leads_by_product.items():
        product_line = ProductLine.objects.get(pk=product_id, organisation=org)

        # Get active salespeople for this product line, ordered by pk for stable ordering
        salespeople = list(
            product_line.salespeople
            .filter(is_active=True)
            .order_by('pk')
        )

        if not salespeople:
            skipped_no_staff += len(leads)
            continue

        idx = product_line.round_robin_index

        for lead in leads:
            sp = salespeople[idx % len(salespeople)]
            sp_name = f"{sp.first_name} {sp.last_name}".strip() or sp.email

            # Track assignment counts
            key = (sp_name, product_line.name)
            assignment_counts[key] = assignment_counts.get(key, 0) + 1

            if not dry_run:
                lead.assigned_to = sp
                lead.save(update_fields=['assigned_to'])

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

            assigned_count += 1
            idx += 1

        if not dry_run:
            # Persist the updated index
            product_line.round_robin_index = idx
            product_line.save(update_fields=['round_robin_index'])

    if not dry_run and activity_logs:
        ActivityLog.objects.bulk_create(activity_logs)

    # Build assignments list grouped by salesperson + product line
    assignments = [
        {'salesperson': sp_name, 'product_line': pl_name, 'count': count}
        for (sp_name, pl_name), count in sorted(assignment_counts.items())
    ]

    return {
        'assigned': assigned_count,
        'skipped_no_product': skipped_no_product,
        'skipped_no_staff': skipped_no_staff,
        'assignments': assignments,
    }
