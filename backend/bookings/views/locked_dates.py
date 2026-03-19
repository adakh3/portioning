from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from bookings.models import LockedDate
from bookings.serializers import LockedDateSerializer
from bookings.permissions import IsManagerOrOwner
from users.mixins import apply_org_filter, get_request_org, get_org_object_or_404


class LockedDateListCreateView(generics.ListCreateAPIView):
    serializer_class = LockedDateSerializer

    def get_permissions(self):
        if self.request.method == 'POST':
            return [IsAuthenticated(), IsManagerOrOwner()]
        return [IsAuthenticated()]

    def get_queryset(self):
        qs = LockedDate.objects.select_related('locked_by')
        qs = apply_org_filter(qs, self.request)

        params = self.request.query_params
        date_from = params.get('date_from')
        date_to = params.get('date_to')
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)

        return qs

    def perform_create(self, serializer):
        serializer.save(
            organisation=get_request_org(self.request),
            locked_by=self.request.user,
        )


class LockedDateDeleteView(generics.DestroyAPIView):
    permission_classes = [IsAuthenticated, IsManagerOrOwner]
    serializer_class = LockedDateSerializer

    def get_queryset(self):
        qs = LockedDate.objects.all()
        return apply_org_filter(qs, self.request)
