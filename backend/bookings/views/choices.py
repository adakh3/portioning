from rest_framework import generics

from users.mixins import OrgQuerySetMixin
from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption, MealTypeOption, ArrangementTypeOption, BeverageTypeOption,
)
from bookings.serializers.choices import (
    EventTypeOptionSerializer, SourceOptionSerializer,
    ServiceStyleOptionSerializer, LeadStatusOptionSerializer,
    LostReasonOptionSerializer, MealTypeOptionSerializer,
    ArrangementTypeOptionSerializer, BeverageTypeOptionSerializer,
)


class EventTypeOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = EventTypeOption.objects.filter(is_active=True)
    serializer_class = EventTypeOptionSerializer


class SourceOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = SourceOption.objects.filter(is_active=True)
    serializer_class = SourceOptionSerializer


class ServiceStyleOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = ServiceStyleOption.objects.filter(is_active=True)
    serializer_class = ServiceStyleOptionSerializer


class LeadStatusOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = LeadStatusOption.objects.filter(is_active=True)
    serializer_class = LeadStatusOptionSerializer


class LostReasonOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = LostReasonOption.objects.filter(is_active=True)
    serializer_class = LostReasonOptionSerializer


class MealTypeOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = MealTypeOption.objects.filter(is_active=True)
    serializer_class = MealTypeOptionSerializer


class ArrangementTypeOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = ArrangementTypeOption.objects.filter(is_active=True)
    serializer_class = ArrangementTypeOptionSerializer


class BeverageTypeOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = BeverageTypeOption.objects.filter(is_active=True)
    serializer_class = BeverageTypeOptionSerializer
