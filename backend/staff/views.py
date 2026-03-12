import math
from datetime import date
from decimal import Decimal

from django.db.models import Sum, Count, Q
from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.response import Response

from users.mixins import OrgQuerySetMixin, OrgCreateMixin
from .models import LaborRole, StaffMember, Shift, AllocationRule
from .serializers import (
    LaborRoleSerializer, StaffMemberSerializer,
    ShiftSerializer, AllocationRuleSerializer,
)


class LaborRoleListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = LaborRole.objects.all()
    serializer_class = LaborRoleSerializer


class LaborRoleDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = LaborRole.objects.all()
    serializer_class = LaborRoleSerializer


class StaffMemberListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = StaffMember.objects.prefetch_related('roles').all()
    serializer_class = StaffMemberSerializer


class StaffMemberDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = StaffMember.objects.prefetch_related('roles').all()
    serializer_class = StaffMemberSerializer


class ShiftListCreateView(generics.ListCreateAPIView):
    serializer_class = ShiftSerializer

    def get_queryset(self):
        qs = Shift.objects.select_related('staff_member', 'role', 'event').all()
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        return qs


class ShiftDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Shift.objects.select_related('staff_member', 'role', 'event').all()
    serializer_class = ShiftSerializer


class AllocationRuleListCreateView(generics.ListCreateAPIView):
    queryset = AllocationRule.objects.select_related('role').all()
    serializer_class = AllocationRuleSerializer


class AllocationRuleDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = AllocationRule.objects.select_related('role').all()
    serializer_class = AllocationRuleSerializer


class StaffReportView(APIView):
    """GET /api/staff/reports/?date_from=&date_to=
    Returns per-staff-member hours worked, total cost, shifts by status."""

    def get(self, request):
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')

        shifts = Shift.objects.select_related('staff_member', 'role')
        if date_from:
            shifts = shifts.filter(start_time__date__gte=date_from)
        if date_to:
            shifts = shifts.filter(start_time__date__lte=date_to)

        members = StaffMember.objects.filter(is_active=True).prefetch_related('roles')
        report = []
        for member in members:
            member_shifts = [s for s in shifts if s.staff_member_id == member.id]
            total_hours = sum((s.duration_hours for s in member_shifts), Decimal('0'))
            total_cost = sum((s.shift_cost for s in member_shifts), Decimal('0'))
            status_counts = {}
            for s in member_shifts:
                status_counts[s.status] = status_counts.get(s.status, 0) + 1

            report.append({
                'staff_member_id': member.id,
                'staff_member_name': member.name,
                'total_shifts': len(member_shifts),
                'total_hours': str(total_hours.quantize(Decimal('0.01'))),
                'total_cost': str(total_cost.quantize(Decimal('0.01'))),
                'shifts_by_status': status_counts,
            })

        return Response(report)
