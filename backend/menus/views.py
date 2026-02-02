from rest_framework import generics
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import MenuTemplate
from .serializers import MenuTemplateListSerializer, MenuTemplateDetailSerializer


class MenuTemplateListView(generics.ListAPIView):
    queryset = MenuTemplate.objects.filter(is_active=True)
    serializer_class = MenuTemplateListSerializer


class MenuTemplateDetailView(generics.RetrieveAPIView):
    queryset = MenuTemplate.objects.filter(is_active=True).prefetch_related('portions__dish')
    serializer_class = MenuTemplateDetailSerializer


class MenuTemplatePreviewView(APIView):
    """Return a CalculationResult-shaped response from stored template portions."""

    def get(self, request, pk):
        from rules.models import GuestProfile

        menu = MenuTemplate.objects.filter(
            is_active=True, pk=pk
        ).prefetch_related('portions__dish__category').first()

        if menu is None:
            return Response({'detail': 'Not found.'}, status=404)

        # Get ladies multiplier from GuestProfile
        ladies_multiplier = 1.0  # fallback default
        try:
            ladies_profile = GuestProfile.objects.get(name='Ladies')
            ladies_multiplier = ladies_profile.portion_multiplier
        except GuestProfile.DoesNotExist:
            pass

        gents = menu.default_gents
        ladies = menu.default_ladies
        total_people = gents + ladies

        portions = []
        total_food_gent = 0
        total_food_lady = 0
        total_food_weight = 0
        total_cost = 0
        total_protein_per_person = 0

        for mp in menu.portions.select_related('dish__category').all():
            dish = mp.dish
            grams_per_gent = round(mp.portion_grams, 1)
            grams_per_lady = round(mp.portion_grams * ladies_multiplier, 1)
            dish_total_grams = round(grams_per_gent * gents + grams_per_lady * ladies, 1)
            grams_per_person = round(dish_total_grams / total_people, 1) if total_people else 0
            cost_per_gent = round(float(dish.cost_per_gram) * grams_per_gent, 2)
            dish_total_cost = round(float(dish.cost_per_gram) * dish_total_grams, 2)

            portions.append({
                'dish_id': dish.id,
                'dish_name': dish.name,
                'category': dish.category.display_name,
                'protein_type': dish.protein_type,
                'pool': dish.category.pool,
                'unit': dish.category.unit,
                'grams_per_person': grams_per_person,
                'grams_per_gent': grams_per_gent,
                'grams_per_lady': grams_per_lady,
                'total_grams': dish_total_grams,
                'cost_per_gent': cost_per_gent,
                'total_cost': dish_total_cost,
            })

            total_food_gent += grams_per_gent
            total_food_lady += grams_per_lady
            total_food_weight += dish_total_grams
            total_cost += dish_total_cost
            if dish.category.pool == 'protein':
                total_protein_per_person += dish_total_grams

        food_per_person = round(total_food_weight / total_people, 1) if total_people else 0
        protein_per_person = round(total_protein_per_person / total_people, 1) if total_people else 0

        return Response({
            'portions': portions,
            'totals': {
                'food_per_gent_grams': round(total_food_gent, 1),
                'food_per_lady_grams': round(total_food_lady, 1),
                'food_per_person_grams': food_per_person,
                'protein_per_person_grams': protein_per_person,
                'total_food_weight_grams': round(total_food_weight, 1),
                'total_cost': round(total_cost, 2),
            },
            'warnings': [],
            'adjustments_applied': [
                f"Showing stored template portions for '{menu.name}'",
            ],
            'source': 'template',
        })
