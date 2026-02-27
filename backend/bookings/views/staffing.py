from rest_framework import generics

from bookings.models import LaborRole, StaffMember, Shift
from bookings.serializers import LaborRoleSerializer, StaffMemberSerializer, ShiftSerializer


class LaborRoleListCreateView(generics.ListCreateAPIView):
    queryset = LaborRole.objects.all()
    serializer_class = LaborRoleSerializer


class LaborRoleDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = LaborRole.objects.all()
    serializer_class = LaborRoleSerializer


class StaffMemberListCreateView(generics.ListCreateAPIView):
    queryset = StaffMember.objects.prefetch_related('roles').all()
    serializer_class = StaffMemberSerializer


class StaffMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
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
