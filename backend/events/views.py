import calendar as cal
from collections import defaultdict
from datetime import date

from django.db.models import Q
from rest_framework import generics, status as http_status
from rest_framework.views import APIView
from rest_framework.response import Response
from bookings.models import LockedDate
from bookings.permissions import is_salesperson
from .models import Event, EventStatus
from users.mixins import get_request_org, apply_org_filter, get_org_object_or_404
from .serializers import EventSerializer, EventListSerializer


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

    def get_serializer_class(self):
        if self.request.method == 'GET':
            return EventListSerializer
        return EventSerializer

    def perform_create(self, serializer):
        org = get_request_org(self.request)
        event_date = serializer.validated_data.get('date')
        if event_date:
            locked = LockedDate.objects.filter(organisation=org, date=event_date).first()
            if locked:
                reason = locked.reason or 'No reason provided'
                from rest_framework.exceptions import ValidationError
                raise ValidationError({
                    'date': f'This date is locked: {reason}',
                })
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user, organisation=org)

    def get_queryset(self):
        _auto_advance_event_statuses(org=get_request_org(self.request))
        qs = Event.objects.select_related(
            'account', 'primary_contact', 'venue', 'based_on_template', 'product', 'source_quote',
        ).prefetch_related(
            'dishes',
        )
        qs = apply_org_filter(qs, self.request)

        # Salesperson sees only events they created
        user = self.request.user
        if is_salesperson(user):
            qs = qs.filter(Q(created_by=user))

        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        product = self.request.query_params.get('product')
        if product:
            qs = qs.filter(product_id=product)
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
            'account', 'primary_contact', 'venue', 'based_on_template', 'product', 'source_quote',
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


class EventCalendarView(APIView):
    """GET /api/events/calendar/?month=2026-03&status=confirmed,tentative&product=1

    Returns per-day summary with two layers:
    - org_event_count / org_total_guests: org-wide totals (context for all users)
    - my_event_count / my_total_guests / my_events: user's own events (clickable)
    - Admins see everything in both layers.
    """

    def get(self, request):
        org = get_request_org(request)
        month_param = request.query_params.get('month')
        if not month_param:
            today = date.today()
            year, month = today.year, today.month
        else:
            try:
                parts = month_param.split('-')
                year, month = int(parts[0]), int(parts[1])
            except (ValueError, IndexError):
                return Response(
                    {'detail': 'Invalid month format. Use YYYY-MM.'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        _, last_day = cal.monthrange(year, month)
        date_from = date(year, month, 1)
        date_to = date(year, month, last_day)

        # Base queryset: all org events in range
        base_qs = Event.objects.select_related('account', 'product').filter(
            date__gte=date_from, date__lte=date_to,
        )
        base_qs = apply_org_filter(base_qs, request)

        # Apply shared filters (product, status) to both layers
        product_param = request.query_params.get('product')
        if product_param:
            base_qs = base_qs.filter(product_id=product_param)

        status_param = request.query_params.get('status')
        if status_param:
            statuses = [s.strip() for s in status_param.split(',') if s.strip()]
            base_qs = base_qs.filter(status__in=statuses)

        user = request.user
        user_is_salesperson = is_salesperson(user)

        # Group by date — track org totals and user's own events separately
        days = defaultdict(lambda: {
            'org_event_count': 0, 'org_total_guests': 0,
            'my_events': [], 'my_event_count': 0, 'my_total_guests': 0,
        })

        for event in base_qs:
            d = str(event.date)
            guests = (event.gents or 0) + (event.ladies or 0)

            # Org-wide totals (always counted)
            days[d]['org_event_count'] += 1
            days[d]['org_total_guests'] += guests

            # User's own events (admins see all, salesperson sees own)
            is_mine = not user_is_salesperson or event.created_by_id == user.pk
            if is_mine:
                days[d]['my_events'].append({
                    'id': event.id,
                    'name': event.name,
                    'status': event.status,
                    'guest_count': guests,
                    'account_name': event.account.name if event.account else None,
                    'product_name': event.product.name if event.product else None,
                    'product_colour': event.product.colour if event.product else None,
                })
                days[d]['my_event_count'] += 1
                days[d]['my_total_guests'] += guests

        result = []
        for d, info in sorted(days.items()):
            result.append({
                'date': d,
                'org_event_count': info['org_event_count'],
                'org_total_guests': info['org_total_guests'],
                'my_event_count': info['my_event_count'],
                'my_total_guests': info['my_total_guests'],
                'my_events': info['my_events'],
            })

        return Response(result)
