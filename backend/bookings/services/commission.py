"""Commission service — gathers won-deal revenue from the CRM and runs the
pure commission engine (``bookings.commission``) to produce a salesperson's
period summary.

Commission is derived live from CRM data: only deals recorded in the CRM count,
which is the whole point — the CRM is where you get paid.
"""
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from bookings.commission import compute_commission
from bookings.models import CommissionBand, Lead, OrgSettings, SalesTarget


def period_bounds(period, today):
    """Return (start_date, end_exclusive_date, label) for the period containing
    ``today``. ``period`` is one of monthly / quarterly / yearly."""
    if period == 'yearly':
        start = date(today.year, 1, 1)
        end = date(today.year + 1, 1, 1)
        return start, end, str(today.year)

    if period == 'quarterly':
        q_index = (today.month - 1) // 3          # 0..3
        start_month = q_index * 3 + 1             # 1,4,7,10
        start = date(today.year, start_month, 1)
        end_month = start_month + 3
        if end_month > 12:
            end = date(today.year + 1, 1, 1)
        else:
            end = date(today.year, end_month, 1)
        return start, end, f'Q{q_index + 1} {today.year}'

    # monthly (default)
    start = date(today.year, today.month, 1)
    if today.month == 12:
        end = date(today.year + 1, 1, 1)
    else:
        end = date(today.year, today.month + 1, 1)
    return start, end, start.strftime('%B %Y')


def _won_revenue(org, user, start=None, end=None):
    """(revenue, deal_count) of won deals for a rep, optionally bounded by
    won_at date [start, end)."""
    qs = Lead.objects.filter(
        organisation=org, assigned_to=user, status='won',
    )
    if start is not None:
        qs = qs.filter(won_at__date__gte=start)
    if end is not None:
        qs = qs.filter(won_at__date__lt=end)
    agg = qs.aggregate(revenue=Sum('won_quote__total'))
    return (agg['revenue'] or Decimal('0')), qs.count()


def commission_summary(org, user, today=None):
    """Build the commission + target summary for one salesperson.

    Returns a plain dict (no Decimal rounding here — the serializer/view rounds
    for display)."""
    today = today or timezone.now().date()
    settings = OrgSettings.for_org(org)
    start, end, label = period_bounds(settings.target_period, today)

    revenue, deals = _won_revenue(org, user, start, end)
    target = (
        SalesTarget.objects
        .filter(organisation=org, user=user)
        .values_list('amount', flat=True)
        .first()
    ) or Decimal('0')
    bands = list(
        CommissionBand.objects
        .filter(organisation=org)
        .order_by('min_attainment_pct')
        .values_list('min_attainment_pct', 'rate')
    )

    result = compute_commission(
        revenue, target,
        model=settings.commission_model,
        flat_rate=settings.commission_flat_rate,
        bands=bands,
    )

    lifetime_revenue, lifetime_deals = _won_revenue(org, user)

    return {
        'period': label,
        'period_unit': settings.target_period,
        'period_start': start,
        'period_end': end,
        'model': settings.commission_model,
        'revenue': revenue,
        'target': target,
        'attainment_pct': result['attainment_pct'],
        'commission': result['commission'],
        'breakdown': result['breakdown'],
        'deals': deals,
        'lifetime_revenue': lifetime_revenue,
        'lifetime_deals': lifetime_deals,
    }
