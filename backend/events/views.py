from datetime import date

from django.db.models import Q
from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.response import Response
from bookings.permissions import is_salesperson
from .models import Event, EventStatus
from users.mixins import get_request_org, apply_org_filter, get_org_object_or_404
from .serializers import EventSerializer


def _auto_advance_event_statuses(org=None):
    """Move confirmed events to in_progress on event day, and to completed the day after.

    When org is provided, only advance that org's events.
    When called without org (e.g. from a cron command), advances all.
    """
    today = date.today()
    confirmed_qs = Event.objects.filter(status=EventStatus.CONFIRMED, date__lte=today)
    in_progress_qs = Event.objects.filter(status=EventStatus.IN_PROGRESS, date__lt=today)
    if org:
        confirmed_qs = confirmed_qs.filter(organisation=org)
        in_progress_qs = in_progress_qs.filter(organisation=org)
    confirmed_qs.update(status=EventStatus.IN_PROGRESS)
    in_progress_qs.update(status=EventStatus.COMPLETED)


class EventListCreateView(generics.ListCreateAPIView):
    serializer_class = EventSerializer

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user, organisation=get_request_org(self.request))

    def get_queryset(self):
        _auto_advance_event_statuses(org=get_request_org(self.request))
        qs = Event.objects.select_related(
            'account', 'primary_contact', 'venue', 'based_on_template',
        ).prefetch_related(
            'dishes', 'dish_comments', 'dish_comments__dish',
            'shifts', 'shifts__staff_member', 'shifts__role',
            'equipment_reservations', 'equipment_reservations__equipment',
            'invoices', 'invoices__payments',
        )
        qs = apply_org_filter(qs, self.request)

        # Salesperson sees only events they created
        user = self.request.user
        if is_salesperson(user):
            qs = qs.filter(Q(created_by=user))

        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(date__gte=date_from)
        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(date__lte=date_to)
        return qs


class EventDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EventSerializer

    def get_queryset(self):
        _auto_advance_event_statuses(org=get_request_org(self.request))
        qs = Event.objects.select_related(
            'account', 'primary_contact', 'venue', 'based_on_template',
        ).prefetch_related(
            'dishes', 'dish_comments', 'dish_comments__dish',
            'shifts', 'shifts__staff_member', 'shifts__role',
            'equipment_reservations', 'equipment_reservations__equipment',
            'invoices', 'invoices__payments',
        )
        return apply_org_filter(qs, self.request)


class EventCalculateView(APIView):
    def post(self, request, pk):
        event = get_org_object_or_404(Event.objects.prefetch_related('dishes'), request, pk=pk)
        from calculator.engine.calculator import calculate_portions

        override = getattr(event, 'constraint_override', None)
        constraint_overrides = {}
        if override:
            if override.max_total_food_per_person_grams is not None:
                constraint_overrides['max_total_food_per_person_grams'] = override.max_total_food_per_person_grams
            if override.min_portion_per_dish_grams is not None:
                constraint_overrides['min_portion_per_dish_grams'] = override.min_portion_per_dish_grams

        result = calculate_portions(
            dish_ids=list(event.dishes.values_list('id', flat=True)),
            guests={'gents': event.gents, 'ladies': event.ladies},
            constraint_overrides=constraint_overrides,
            big_eaters=event.big_eaters,
            big_eaters_percentage=event.big_eaters_percentage,
            org=event.organisation,
        )
        return Response(result)
