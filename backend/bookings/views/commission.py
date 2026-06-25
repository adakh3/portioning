from decimal import Decimal, ROUND_HALF_UP

from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status, generics

from users.mixins import get_request_org, apply_org_filter
from users.models import User
from bookings.permissions import IsAdminOrOwner
from bookings.models import CommissionBand, SalesTarget
from bookings.serializers.commission import CommissionBandSerializer, SalesTargetSerializer
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


# --- Admin config (Settings UI) ---

class CommissionBandManageListCreateView(generics.ListCreateAPIView):
    """List + create commission bands for the org (admin/owner)."""
    serializer_class = CommissionBandSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        return apply_org_filter(
            CommissionBand.objects.all().order_by('min_attainment_pct'), self.request,
        )

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))


class CommissionBandManageDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommissionBandSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        return apply_org_filter(CommissionBand.objects.all(), self.request)


class SalesTargetManageView(APIView):
    """List all sales targets, or upsert one for a user (admin/owner)."""
    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        qs = apply_org_filter(SalesTarget.objects.select_related('user').all(), request)
        return Response(SalesTargetSerializer(qs, many=True).data)

    def put(self, request):
        org = get_request_org(request)
        user_id = request.data.get('user')
        amount = request.data.get('amount')
        if not User.objects.filter(pk=user_id, organisation=org).exists():
            return Response({'error': 'Invalid user for this organisation.'},
                            status=status.HTTP_400_BAD_REQUEST)
        target, _ = SalesTarget.objects.update_or_create(
            organisation=org, user_id=user_id,
            defaults={'amount': amount or Decimal('0')},
        )
        return Response(SalesTargetSerializer(target).data)
