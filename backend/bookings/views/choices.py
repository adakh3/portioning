from django.utils.text import slugify
from rest_framework import generics, serializers

from users.mixins import OrgQuerySetMixin, get_request_org
from bookings.models import Lead
from bookings.models.choices import (
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption, MealTypeOption,
)
from bookings.permissions import IsManagerOrOwner
from bookings.serializers.choices import (
    EventTypeOptionSerializer, SourceOptionSerializer,
    ServiceStyleOptionSerializer, LeadStatusOptionSerializer,
    LostReasonOptionSerializer, MealTypeOptionSerializer,
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


def _unique_status_value(org, label):
    """Generate a stable, unique key for a new status from its label."""
    base = (slugify(label).replace('-', '_') or 'status')[:50]
    existing = set(
        LeadStatusOption.objects.filter(organisation=org).values_list('value', flat=True)
    )
    value, i = base, 2
    while value in existing:
        value = f"{base}_{i}"[:50]
        i += 1
    return value


def _enforce_singletons(instance):
    """Keep at most one default / won / lost stage per org."""
    others = LeadStatusOption.objects.filter(
        organisation=instance.organisation,
    ).exclude(pk=instance.pk)
    if instance.is_default:
        others.filter(is_default=True).update(is_default=False)
    if instance.is_won:
        others.filter(is_won=True).update(is_won=False)
    if instance.is_lost:
        others.filter(is_lost=True).update(is_lost=False)


class LeadStatusManageListCreateView(OrgQuerySetMixin, generics.ListCreateAPIView):
    """Manage lead statuses from Settings (manager/owner). Lists ALL statuses
    (including inactive) so they can be reactivated."""
    queryset = LeadStatusOption.objects.all().order_by('sort_order', 'pk')
    serializer_class = LeadStatusOptionSerializer
    permission_classes = [IsManagerOrOwner]

    def perform_create(self, serializer):
        org = get_request_org(self.request)
        value = _unique_status_value(org, serializer.validated_data.get('label', ''))
        instance = serializer.save(organisation=org, value=value)
        _enforce_singletons(instance)


class LeadStatusManageDetailView(OrgQuerySetMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = LeadStatusOption.objects.all()
    serializer_class = LeadStatusOptionSerializer
    permission_classes = [IsManagerOrOwner]

    def perform_update(self, serializer):
        instance = serializer.save()
        _enforce_singletons(instance)

    def perform_destroy(self, instance):
        if Lead.objects.filter(
            organisation=instance.organisation, status=instance.value,
        ).exists():
            raise serializers.ValidationError(
                'Cannot delete a status that leads are using — deactivate it instead.'
            )
        if instance.is_default:
            raise serializers.ValidationError(
                'Cannot delete the default status. Set another status as default first.'
            )
        instance.delete()


class LostReasonOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = LostReasonOption.objects.filter(is_active=True)
    serializer_class = LostReasonOptionSerializer


class MealTypeOptionListView(OrgQuerySetMixin, generics.ListAPIView):
    queryset = MealTypeOption.objects.filter(is_active=True)
    serializer_class = MealTypeOptionSerializer
