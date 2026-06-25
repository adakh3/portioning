"""Commission service — gathers confirmed-event revenue from the CRM and runs
the pure commission engine (``bookings.commission``) to produce a salesperson's
period summary.

Commission is based on **events**, not leads: a won lead is provisional, but a
confirmed event is the real booking with real revenue (``Event.total``). Credit
goes to the event's ``assigned_to`` (set from the lead's owner, or the creator
for directly-created events, and editable by an admin to correct attribution).
"""
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from bookings.commission import compute_commission
from bookings.models import CommissionPlan, OrgSettings, SalesTarget
from events.models import Event

# Statuses that represent a real, booked event (excludes tentative + cancelled).
EARNED_EVENT_STATUSES = ['confirmed', 'in_progress', 'completed']

# Org's commission_basis -> the Event date field that buckets it into a period.
BASIS_TO_DATE_FIELD = {'event_date': 'date', 'booking_date': 'booking_date'}


def rep_plan(org, user):
    """The commission plan a salesperson is on: their assigned plan, else the
    org's default plan (else None)."""
    st = (
        SalesTarget.objects
        .filter(organisation=org, user=user)
        .select_related('plan')
        .first()
    )
    if st and st.plan_id:
        return st.plan
    return CommissionPlan.objects.filter(organisation=org, is_default=True).first()


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


def _event_revenue(org, user, date_field, start=None, end=None):
    """(revenue, event_count) of a rep's confirmed events, optionally bounded by
    ``date_field`` in [start, end). Revenue is the sum of ``Event.total``."""
    qs = Event.objects.filter(
        organisation=org, assigned_to=user, status__in=EARNED_EVENT_STATUSES,
    )
    if start is not None:
        qs = qs.filter(**{f'{date_field}__gte': start})
    if end is not None:
        qs = qs.filter(**{f'{date_field}__lt': end})
    agg = qs.aggregate(revenue=Sum('total'))
    return (agg['revenue'] or Decimal('0')), qs.count()


def commission_summary(org, user, today=None):
    """Build the commission + target summary for one salesperson.

    Returns a plain dict (no Decimal rounding here — the serializer/view rounds
    for display)."""
    today = today or timezone.now().date()
    settings = OrgSettings.for_org(org)
    date_field = BASIS_TO_DATE_FIELD.get(settings.commission_basis, 'date')
    start, end, label = period_bounds(settings.target_period, today)

    revenue, deals = _event_revenue(org, user, date_field, start, end)
    target = (
        SalesTarget.objects
        .filter(organisation=org, user=user)
        .values_list('amount', flat=True)
        .first()
    ) or Decimal('0')
    plan = rep_plan(org, user)
    if plan is not None:
        model = plan.commission_model
        flat_rate = plan.commission_flat_rate
        bands = list(plan.bands.order_by('min_attainment_pct').values_list('min_attainment_pct', 'rate'))
    else:
        model, flat_rate, bands = 'flat', Decimal('0'), []

    result = compute_commission(
        revenue, target, model=model, flat_rate=flat_rate, bands=bands,
    )

    lifetime_revenue, lifetime_deals = _event_revenue(org, user, date_field)

    return {
        'period': label,
        'period_unit': settings.target_period,
        'period_start': start,
        'period_end': end,
        'model': model,
        'plan': plan.name if plan is not None else None,
        'basis': settings.commission_basis,
        'revenue': revenue,
        'target': target,
        'attainment_pct': result['attainment_pct'],
        'commission': result['commission'],
        'breakdown': result['breakdown'],
        'deals': deals,
        'lifetime_revenue': lifetime_revenue,
        'lifetime_deals': lifetime_deals,
    }
