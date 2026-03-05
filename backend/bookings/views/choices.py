from rest_framework import generics

from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
)
from bookings.serializers.choices import (
    EventTypeOptionSerializer, SourceOptionSerializer,
    ServiceStyleOptionSerializer, LeadStatusOptionSerializer,
)


class EventTypeOptionListView(generics.ListAPIView):
    queryset = EventTypeOption.objects.filter(is_active=True)
    serializer_class = EventTypeOptionSerializer


class SourceOptionListView(generics.ListAPIView):
    queryset = SourceOption.objects.filter(is_active=True)
    serializer_class = SourceOptionSerializer


class ServiceStyleOptionListView(generics.ListAPIView):
    queryset = ServiceStyleOption.objects.filter(is_active=True)
    serializer_class = ServiceStyleOptionSerializer


class LeadStatusOptionListView(generics.ListAPIView):
    queryset = LeadStatusOption.objects.filter(is_active=True)
    serializer_class = LeadStatusOptionSerializer
