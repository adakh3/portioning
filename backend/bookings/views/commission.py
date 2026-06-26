from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status, generics

from users.mixins import get_request_org, apply_org_filter
from users.models import User
from bookings.permissions import IsAdminOrOwner
from bookings.models import CommissionPlan, CommissionBand, SalesTarget, RepCommissionPlan, OrgSettings
from bookings.serializers.commission import (
    CommissionPlanSerializer, CommissionBandSerializer,
)
from bookings.services.commission import (
    commission_summary, period_position, period_labels, fiscal_year_label, PERIOD_LENGTHS,
)


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
            'plan': s['plan'],
            'basis': s['basis'],
            'revenue': _money(s['revenue']),
            'target': _money(s['target']),
            'attainment_pct': _pct(s['attainment_pct']),
            'commission': _money(s['commission']),
            'deals': s['deals'],
            'year_label': s['year_label'],
            'year_revenue': _money(s['year_revenue']),
            'year_target': _money(s['year_target']),
            'year_deals': s['year_deals'],
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

class CommissionPlanManageListCreateView(generics.ListCreateAPIView):
    """List + create commission plans for the org (admin/owner)."""
    serializer_class = CommissionPlanSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        return apply_org_filter(CommissionPlan.objects.all().order_by('name'), self.request)

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))


class CommissionPlanManageDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommissionPlanSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        return apply_org_filter(CommissionPlan.objects.all(), self.request)

    def perform_destroy(self, instance):
        if instance.is_default:
            from rest_framework import serializers as drf_serializers
            raise drf_serializers.ValidationError('The default plan cannot be deleted.')
        instance.delete()


class CommissionBandManageListCreateView(generics.ListCreateAPIView):
    """List + create bands, scoped to a plan via ?plan=<id> (admin/owner)."""
    serializer_class = CommissionBandSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        qs = apply_org_filter(CommissionBand.objects.all().order_by('min_attainment_pct'), self.request)
        plan = self.request.query_params.get('plan')
        return qs.filter(plan_id=plan) if plan else qs

    def perform_create(self, serializer):
        serializer.save(organisation=get_request_org(self.request))


class CommissionBandManageDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommissionBandSerializer
    permission_classes = [IsAdminOrOwner]

    def get_queryset(self):
        return apply_org_filter(CommissionBand.objects.all(), self.request)


def _rep_name(u):
    return f'{u.first_name} {u.last_name}'.strip() or u.email


class SalesTargetGridView(APIView):
    """The per-period targets grid (admin/owner). Shape follows the org's
    ``target_period`` + ``fiscal_year_start_month``.

    GET ?fiscal_year=YYYY  → columns + a row per salesperson with their cells.
    PUT {user, fiscal_year, period_index, amount}  → upsert a single cell."""
    permission_classes = [IsAdminOrOwner]

    def get(self, request):
        org = get_request_org(request)
        settings = OrgSettings.for_org(org)
        pt = settings.target_period
        fsm = settings.fiscal_year_start_month
        n = PERIOD_LENGTHS.get(pt, 1)

        fy_param = request.query_params.get('fiscal_year')
        if fy_param:
            fy = int(fy_param)
        else:
            fy, _, _ = period_position(timezone.now().date(), pt, fsm)

        labels = period_labels(pt, fsm)
        columns = [{'index': i, 'label': labels[i]} for i in range(n)]

        reps = User.objects.filter(
            organisation=org, role='salesperson', is_active=True,
        ).order_by('first_name', 'last_name')

        cell_map = {}
        for c in SalesTarget.objects.filter(organisation=org, period_type=pt, fiscal_year=fy):
            cell_map[(c.user_id, c.period_index)] = c.amount
        plan_map = {
            rp.user_id: rp.plan_id
            for rp in RepCommissionPlan.objects.filter(organisation=org)
        }

        rep_rows = []
        for u in reps:
            cells = {i: _money(cell_map.get((u.id, i), Decimal('0'))) for i in range(n)}
            total = sum((cell_map.get((u.id, i), Decimal('0')) for i in range(n)), Decimal('0'))
            rep_rows.append({
                'user_id': u.id,
                'user_name': _rep_name(u),
                'plan': plan_map.get(u.id),
                'cells': cells,
                'total': _money(total),
            })

        return Response({
            'period_type': pt,
            'fiscal_year': fy,
            'fiscal_year_label': fiscal_year_label(fsm, fy),
            'fiscal_start_month': fsm,
            'columns': columns,
            'reps': rep_rows,
        })

    def put(self, request):
        org = get_request_org(request)
        settings = OrgSettings.for_org(org)
        pt = settings.target_period
        n = PERIOD_LENGTHS.get(pt, 1)

        user_id = request.data.get('user')
        if not User.objects.filter(pk=user_id, organisation=org, role='salesperson').exists():
            return Response({'error': 'Invalid salesperson for this organisation.'},
                            status=status.HTTP_400_BAD_REQUEST)
        try:
            fy = int(request.data.get('fiscal_year'))
            idx = int(request.data.get('period_index'))
            amount = Decimal(str(request.data.get('amount') or '0'))
        except (TypeError, ValueError):
            return Response({'error': 'fiscal_year, period_index and amount are required.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not (0 <= idx < n):
            return Response({'error': f'period_index out of range for {pt} targets.'},
                            status=status.HTTP_400_BAD_REQUEST)

        SalesTarget.objects.update_or_create(
            organisation=org, user_id=user_id, period_type=pt,
            fiscal_year=fy, period_index=idx, defaults={'amount': amount},
        )
        return Response({'ok': True})


class RepPlanManageView(APIView):
    """Assign a salesperson's commission plan (admin/owner).
    PUT {user, plan}  (plan null = org default)."""
    permission_classes = [IsAdminOrOwner]

    def put(self, request):
        org = get_request_org(request)
        user_id = request.data.get('user')
        if not User.objects.filter(pk=user_id, organisation=org, role='salesperson').exists():
            return Response({'error': 'Invalid salesperson for this organisation.'},
                            status=status.HTTP_400_BAD_REQUEST)
        plan_id = request.data.get('plan')
        if plan_id and not CommissionPlan.objects.filter(pk=plan_id, organisation=org).exists():
            return Response({'error': 'Invalid plan for this organisation.'},
                            status=status.HTTP_400_BAD_REQUEST)
        RepCommissionPlan.objects.update_or_create(
            organisation=org, user_id=user_id, defaults={'plan_id': plan_id or None},
        )
        return Response({'ok': True})
