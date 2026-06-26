"""Commission service — gathers confirmed-event revenue from the CRM and runs
the pure commission engine (``bookings.commission``) to produce a salesperson's
period summary.

Commission is based on **events**, not leads: a won lead is provisional, but a
confirmed event is the real booking with real revenue (``Event.total``). Credit
goes to the event's ``assigned_to`` (set from the lead's owner, or the creator
for directly-created events, and editable by an admin to correct attribution).
"""
import calendar
from datetime import date
from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from bookings.commission import compute_commission
from bookings.models import CommissionPlan, OrgSettings, SalesTarget, RepCommissionPlan
from events.models import Event

# Statuses that represent a real, booked event (excludes tentative + cancelled).
EARNED_EVENT_STATUSES = ['confirmed', 'in_progress', 'completed']

# Org's commission_basis -> the Event date field that buckets it into a period.
BASIS_TO_DATE_FIELD = {'event_date': 'date', 'booking_date': 'booking_date'}

# How many target cells make up a financial year for each period type.
PERIOD_LENGTHS = {'monthly': 12, 'quarterly': 4, 'yearly': 1}


def rep_plan(org, user):
    """The commission plan a salesperson is on: their assigned plan, else the
    org's default plan (else None)."""
    rp = (
        RepCommissionPlan.objects
        .filter(organisation=org, user=user)
        .select_related('plan')
        .first()
    )
    if rp and rp.plan_id:
        return rp.plan
    return CommissionPlan.objects.filter(organisation=org, is_default=True).first()


def period_position(today, period_type, fiscal_start=1):
    """Locate ``today`` within the financial year as (fiscal_year, period_index,
    period_count). ``fiscal_year`` is the calendar year the FY starts in;
    ``period_index`` is 0-based from that start."""
    fy_start, _, _ = fiscal_year_bounds(today, fiscal_start)
    months_in = (today.year - fy_start.year) * 12 + (today.month - fy_start.month)
    count = PERIOD_LENGTHS.get(period_type, 1)
    if period_type == 'monthly':
        index = months_in
    elif period_type == 'quarterly':
        index = months_in // 3
    else:  # yearly
        index = 0
    return fy_start.year, index, count


def rep_target(org, user, today, period_type, fiscal_start=1):
    """The rep's target for the period containing ``today`` (0 if unset)."""
    fy, index, _ = period_position(today, period_type, fiscal_start)
    amount = (
        SalesTarget.objects
        .filter(organisation=org, user=user, period_type=period_type,
                fiscal_year=fy, period_index=index)
        .values_list('amount', flat=True)
        .first()
    )
    return amount or Decimal('0')


def fiscal_year_label(fiscal_start, fiscal_year):
    """Human label for a financial year: '2026' for a calendar year, 'FY 2026/27'
    for a fiscal one."""
    if fiscal_start == 1:
        return str(fiscal_year)
    return f'FY {fiscal_year}/{(fiscal_year + 1) % 100:02d}'


def period_labels(period_type, fiscal_start=1):
    """Column labels for the targets grid, in financial-year order."""
    if period_type == 'monthly':
        return [calendar.month_abbr[(fiscal_start - 1 + i) % 12 + 1] for i in range(12)]
    if period_type == 'quarterly':
        return [f'Q{i + 1}' for i in range(4)]
    return ['Year']


def fiscal_year_bounds(today, start_month=1):
    """Return (start_date, end_exclusive_date, label) of the financial year that
    contains ``today``, where the year begins on the 1st of ``start_month``
    (1 = calendar year)."""
    if today.month >= start_month:
        start = date(today.year, start_month, 1)
    else:
        start = date(today.year - 1, start_month, 1)
    end = date(start.year + 1, start_month, 1)
    label = str(start.year) if start_month == 1 else f'FY {start.year}/{(start.year + 1) % 100:02d}'
    return start, end, label


def period_bounds(period, today, fiscal_start=1):
    """Return (start_date, end_exclusive_date, label) for the period containing
    ``today``. ``period`` is one of monthly / quarterly / yearly. The yearly
    period honours ``fiscal_start`` (the org's financial-year start month)."""
    if period == 'yearly':
        return fiscal_year_bounds(today, fiscal_start)

    if period == 'quarterly':
        # Fiscal quarters: Q1 starts at the financial-year start month.
        fy_start, _, _ = fiscal_year_bounds(today, fiscal_start)
        months_in = (today.year - fy_start.year) * 12 + (today.month - fy_start.month)
        q_index = months_in // 3                  # 0..3
        start_abs = (fy_start.month - 1) + q_index * 3
        start = date(fy_start.year + start_abs // 12, start_abs % 12 + 1, 1)
        end_abs = start_abs + 3
        end = date(fy_start.year + end_abs // 12, end_abs % 12 + 1, 1)
        suffix = str(fy_start.year) if fiscal_start == 1 else fiscal_year_label(fiscal_start, fy_start.year)
        return start, end, f'Q{q_index + 1} {suffix}'

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
    fiscal_start = settings.fiscal_year_start_month
    start, end, label = period_bounds(settings.target_period, today, fiscal_start)

    revenue, deals = _event_revenue(org, user, date_field, start, end)
    target = rep_target(org, user, today, settings.target_period, fiscal_start)
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

    year_start, year_end, year_label = fiscal_year_bounds(today, fiscal_start)
    year_revenue, year_deals = _event_revenue(org, user, date_field, year_start, year_end)

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
        'year_label': year_label,
        'year_revenue': year_revenue,
        'year_deals': year_deals,
    }
