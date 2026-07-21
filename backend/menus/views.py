from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from users.mixins import OrgQuerySetMixin, apply_org_filter, get_request_org
from .models import MenuTemplate, MenuTemplatePriceTier
from .serializers import MenuTemplateListSerializer, MenuTemplateDetailSerializer


class MenuTemplateListView(OrgQuerySetMixin, generics.ListAPIView):
    # Prefetch what the list serializer's method-fields read, so dish_count /
    # suggested_price / has_unpriced don't each query per template (N+1).
    queryset = MenuTemplate.objects.filter(is_active=True).prefetch_related(
        'portions__dish', 'price_tiers')
    serializer_class = MenuTemplateListSerializer


class MenuTemplateDetailView(OrgQuerySetMixin, generics.RetrieveAPIView):
    # portions serializer reads dish.category.display_name; price_tiers is nested.
    queryset = MenuTemplate.objects.filter(is_active=True).prefetch_related(
        'portions__dish__category', 'price_tiers')
    serializer_class = MenuTemplateDetailSerializer


def _template_segments(menu):
    """Two-segment (gents/ladies) mix for a template preview, from the template's
    default counts and the org's 'Ladies' segment multiplier (1.0 if none)."""
    from calculator.engine.models import Segment
    from rules.models import GuestSegment

    ladies_multiplier = 1.0
    ladies = GuestSegment.objects.filter(
        name='Ladies', organisation=menu.organisation,
    ).first()
    if ladies is not None:
        ladies_multiplier = ladies.portion_multiplier
    return [
        Segment('gents', menu.default_gents, 1.0, True),
        Segment('ladies', menu.default_ladies, ladies_multiplier, True),
    ]


class MenuTemplatePreviewView(APIView):
    """Return a CalculationResult-shaped response from stored template portions."""

    def get(self, request, pk):
        from calculator.engine.models import Segment

        qs = apply_org_filter(
            MenuTemplate.objects.filter(is_active=True), request,
        )
        menu = qs.filter(pk=pk).prefetch_related('portions__dish__category').first()

        if menu is None:
            return Response({'detail': 'Not found.'}, status=404)

        # A menu template carries only its default gents/ladies buckets, so the
        # preview is a two-segment mix: gents is the base (1.0), ladies scaled by
        # the org's 'ladies' segment multiplier (1.0 if the org has none).
        segments = _template_segments(menu)
        total_people = sum(s.count for s in segments)

        def _lady_grams(seg_grams, base_grams):
            for name, grams in seg_grams.items():
                if name.lower() == 'ladies':
                    return grams
            return base_grams

        portions = []
        total_food_gent = 0
        total_food_lady = 0
        total_food_weight = 0
        total_cost = 0
        total_protein_per_person = 0

        for mp in menu.portions.select_related('dish__category').all():
            dish = mp.dish
            base_grams = round(mp.portion_grams, 1)
            seg_grams = {
                s.name: round(base_grams * s.portion_multiplier, 1) for s in segments
            }
            dish_total_grams = round(
                sum(seg_grams[s.name] * s.count for s in segments), 1
            )
            grams_per_person = round(dish_total_grams / total_people, 1) if total_people else 0
            cost_per_gent = round(float(dish.cost_per_gram) * base_grams, 2)
            dish_total_cost = round(float(dish.cost_per_gram) * dish_total_grams, 2)
            grams_per_lady = _lady_grams(seg_grams, base_grams)

            portions.append({
                'dish_id': dish.id,
                'dish_name': dish.name,
                'category': dish.category.display_name,
                'protein_type': dish.protein_type,
                'pool': dish.category.pool,
                'unit': dish.category.unit,
                'grams_per_person': grams_per_person,
                'grams_per_gent': base_grams,
                'grams_per_lady': grams_per_lady,
                'grams_by_segment': seg_grams,
                'total_grams': dish_total_grams,
                'cost_per_gent': cost_per_gent,
                'total_cost': dish_total_cost,
            })

            total_food_gent += base_grams
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


class MenuPriceCheckView(APIView):
    """Return pricing anchored to template tier price, adjusted by per-dish surcharges."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from dishes.models import Dish

        menu = apply_org_filter(
            MenuTemplate.objects.filter(is_active=True), request,
        ).filter(pk=pk).first()
        if menu is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        guest_count = request.data.get('guest_count')
        dish_ids = request.data.get('dish_ids')
        if not guest_count or not dish_ids:
            return Response(
                {'detail': 'guest_count and dish_ids are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            guest_count = int(guest_count)
            dish_ids = [int(d) for d in dish_ids]
        except (ValueError, TypeError):
            return Response(
                {'detail': 'guest_count must be an integer and dish_ids must be a list of integers.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1. Select tier: highest where min_guests <= guest_count
        tier = (
            MenuTemplatePriceTier.objects
            .filter(menu=menu, min_guests__lte=guest_count)
            .order_by('-min_guests')
            .first()
        )
        if tier is None:
            return Response(
                {'detail': 'No price tier found for this guest count.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tier_price = float(tier.price_per_head)
        tier_label = f"{tier.min_guests}+ pax"

        # 2. Diff original vs modified dish sets
        original_ids = set(
            menu.portions.values_list('dish__id', flat=True)
        )
        modified_ids = set(dish_ids)
        added_ids = modified_ids - original_ids
        removed_ids = original_ids - modified_ids

        # 3. Load added and removed dishes with their categories
        added_dishes = (
            Dish.objects.filter(id__in=added_ids, organisation=menu.organisation).select_related('category')
            if added_ids else []
        )
        removed_dishes = (
            Dish.objects.filter(id__in=removed_ids, organisation=menu.organisation).select_related('category')
            if removed_ids else []
        )

        # 4. Compute per-dish adjustments (dish-level surcharge, fallback to category)
        breakdown = []
        total_adjustment = 0.0

        for dish in added_dishes:
            surcharge = float(dish.addition_surcharge) or float(dish.category.addition_surcharge)
            breakdown.append({
                'dish': dish.name,
                'category': dish.category.display_name,
                'type': 'addition',
                'amount': surcharge,
            })
            total_adjustment += surcharge

        for dish in removed_dishes:
            discount = float(dish.removal_discount) or float(dish.category.removal_discount)
            breakdown.append({
                'dish': dish.name,
                'category': dish.category.display_name,
                'type': 'removal',
                'amount': -discount,
            })
            total_adjustment -= discount

        adjusted_price = tier_price + total_adjustment

        # Apply rounding step from settings
        from bookings.models import OrgSettings
        step = OrgSettings.for_org(get_request_org(request)).price_rounding_step
        if step > 1:
            adjusted_price = round(adjusted_price / step) * step

        return Response({
            'tier_price': tier_price,
            'tier_label': tier_label,
            'breakdown': breakdown,
            'total_adjustment': round(total_adjustment, 2),
            'adjusted_price': round(adjusted_price, 2),
        })
