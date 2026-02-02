from rest_framework import generics
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import Event
from .serializers import EventSerializer


class EventListCreateView(generics.ListCreateAPIView):
    queryset = Event.objects.all().prefetch_related('dishes')
    serializer_class = EventSerializer


class EventDetailView(generics.RetrieveUpdateAPIView):
    queryset = Event.objects.all().prefetch_related('dishes')
    serializer_class = EventSerializer


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
