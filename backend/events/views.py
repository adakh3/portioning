from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Event
from .serializers import EventSerializer


class EventListCreateView(generics.ListCreateAPIView):
    serializer_class = EventSerializer

    def get_queryset(self):
        qs = Event.objects.select_related(
            'account', 'primary_contact', 'venue', 'based_on_template',
        ).prefetch_related(
            'dishes', 'dish_comments', 'dish_comments__dish',
            'shifts', 'shifts__staff_member', 'shifts__role',
            'equipment_reservations', 'equipment_reservations__equipment',
            'invoices', 'invoices__payments',
        ).all()
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


class EventDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = EventSerializer
    queryset = Event.objects.select_related(
        'account', 'primary_contact', 'venue', 'based_on_template',
    ).prefetch_related(
        'dishes', 'dish_comments', 'dish_comments__dish',
        'shifts', 'shifts__staff_member', 'shifts__role',
        'equipment_reservations', 'equipment_reservations__equipment',
        'invoices', 'invoices__payments',
    ).all()


class EventCalculateView(APIView):
    def post(self, request, pk):
        event = Event.objects.prefetch_related('dishes').get(pk=pk)
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
        )
        return Response(result)
