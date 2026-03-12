from rest_framework import generics

from users.mixins import OrgQuerySetMixin, OrgCreateMixin
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
        event_id = self.request.query_params.get('event')
        if event_id:
            qs = qs.filter(event_id=event_id)
        return qs


class EquipmentReservationDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = EquipmentReservation.objects.select_related('equipment', 'event').all()
    serializer_class = EquipmentReservationSerializer
