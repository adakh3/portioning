from rest_framework import generics

from users.mixins import OrgQuerySetMixin, OrgCreateMixin, get_request_org, is_superuser_without_org
from .models import EquipmentItem, EquipmentReservation
from .serializers import EquipmentItemSerializer, EquipmentReservationSerializer


class EquipmentItemListCreateView(OrgQuerySetMixin, OrgCreateMixin, generics.ListCreateAPIView):
    queryset = EquipmentItem.objects.all()
    serializer_class = EquipmentItemSerializer


class EquipmentItemDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = EquipmentItem.objects.all()
    serializer_class = EquipmentItemSerializer


class EquipmentReservationListCreateView(generics.ListCreateAPIView):
    serializer_class = EquipmentReservationSerializer

    def get_queryset(self):
        qs = EquipmentReservation.objects.select_related('equipment', 'event').all()
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(event__organisation=org)
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        return qs


class EquipmentReservationDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EquipmentReservationSerializer

    def get_queryset(self):
        qs = EquipmentReservation.objects.select_related('equipment', 'event').all()
        if not is_superuser_without_org(self.request):
            org = get_request_org(self.request)
            if org is not None:
                qs = qs.filter(event__organisation=org)
        return qs
