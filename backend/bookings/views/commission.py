from decimal import Decimal, ROUND_HALF_UP

from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from users.mixins import get_request_org
from bookings.services.commission import commission_summary


def _money(value):
    return str(Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def _pct(value):
    return str(Decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


class MyCommissionView(APIView):
    """GET /api/bookings/commission/me/ — the logged-in salesperson's commission
    and progress to target for the current period, derived from won deals in the
    CRM."""

    def get(self, request):
        org = get_request_org(request)
        if org is None:
            return Response(
                {'detail': 'No organisation for this user.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        s = commission_summary(org, request.user)
        return Response({
            'period': s['period'],
            'period_unit': s['period_unit'],
            'period_start': s['period_start'],
            'period_end': s['period_end'],
            'model': s['model'],
            'basis': s['basis'],
            'revenue': _money(s['revenue']),
            'target': _money(s['target']),
            'attainment_pct': _pct(s['attainment_pct']),
            'commission': _money(s['commission']),
            'deals': s['deals'],
            'lifetime_revenue': _money(s['lifetime_revenue']),
            'lifetime_deals': s['lifetime_deals'],
            'breakdown': [
                {
                    'from_pct': _pct(b['from_pct']),
                    'to_pct': _pct(b['to_pct']) if b['to_pct'] is not None else None,
                    'rate': _pct(b['rate']),
                    'revenue_in_band': _money(b['revenue_in_band']),
                    'commission': _money(b['commission']),
                }
                for b in s['breakdown']
            ],
        })
