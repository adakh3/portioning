from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .serializers import CalculateRequestSerializer, ExportPDFRequestSerializer, CheckPortionsRequestSerializer
from .engine.calculator import calculate_portions, _load_dishes, _load_config_and_ceilings, _resolve_constraints
from .engine.checker import check_user_portions
from .engine.models import GuestMix
from .pdf import generate_portion_pdf


class CalculateView(APIView):
    def post(self, request):
        serializer = CalculateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        result = calculate_portions(
            dish_ids=data['dish_ids'],
            guests=data['guests'],
            constraint_overrides=data.get('constraint_overrides', {}),
            big_eaters=data.get('big_eaters', False),
            big_eaters_percentage=data.get('big_eaters_percentage', 20.0),
        )
        return Response(result)


class CheckPortionsView(APIView):
    def post(self, request):
        serializer = CheckPortionsRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        dish_ids = data['dish_ids']
        guests = data['guests']
        constraint_overrides = data.get('constraint_overrides', {})
        big_eaters = data.get('big_eaters', False)
        big_eaters_percentage = data.get('big_eaters_percentage', 20.0)

        # Load dishes and config
        dishes = _load_dishes(dish_ids)
        if not dishes:
            return Response(
                {'error': 'No active dishes found for the given IDs.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dish_category_ids = list(set(d.category_id for d in dishes))
        config, protein_ceiling, accompaniment_ceiling, dessert_ceiling, _, guest_profiles, _ = \
            _load_config_and_ceilings(dish_category_ids)
        constraints = _resolve_constraints(constraint_overrides)
        guest_mix = GuestMix(**guests)

        pool_ceilings = {
            'protein': protein_ceiling,
            'accompaniment': accompaniment_ceiling,
            'dessert': dessert_ceiling,
        }

        # Build user_portions dict
        user_portions_dict = {
            p['dish_id']: p['grams_per_person']
            for p in data['user_portions']
        }

        ladies_mult = guest_profiles.get('ladies', 1.0)

        # Run checker
        check_result = check_user_portions(
            user_portions=user_portions_dict,
            dishes=dishes,
            constraints=constraints,
            pool_ceilings=pool_ceilings,
            guest_mix=guest_mix,
            ladies_multiplier=ladies_mult,
            big_eaters=big_eaters,
            big_eaters_percentage=big_eaters_percentage,
        )

        # Run engine for comparison
        engine_result = calculate_portions(
            dish_ids=dish_ids,
            guests=guests,
            constraint_overrides=constraint_overrides,
            big_eaters=big_eaters,
            big_eaters_percentage=big_eaters_percentage,
        )

        # Build comparison list
        engine_by_dish = {p['dish_id']: p for p in engine_result['portions']}
        user_by_dish = {p['dish_id']: p for p in check_result['user_portions_expanded']}

        comparison = []
        for dish in dishes:
            user_row = user_by_dish.get(dish.id, {})
            engine_row = engine_by_dish.get(dish.id, {})
            user_grams = user_row.get('grams_per_person', 0)
            engine_grams = engine_row.get('grams_per_person', 0)
            delta_grams = round(user_grams - engine_grams, 1)
            delta_percent = round(
                (delta_grams / engine_grams * 100) if engine_grams else 0, 1
            )
            comparison.append({
                'dish_id': dish.id,
                'dish_name': dish.name,
                'category': dish.category_name,
                'pool': dish.pool,
                'unit': dish.unit,
                'user_grams': user_grams,
                'engine_grams': engine_grams,
                'delta_grams': delta_grams,
                'delta_percent': delta_percent,
            })

        return Response({
            'violations': check_result['violations'],
            'user_portions_expanded': check_result['user_portions_expanded'],
            'engine_portions': engine_result['portions'],
            'comparison': comparison,
            'user_totals': check_result['totals'],
            'engine_totals': engine_result['totals'],
        })


class ExportPDFView(APIView):
    def post(self, request):
        serializer = ExportPDFRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        result = calculate_portions(
            dish_ids=data['dish_ids'],
            guests=data['guests'],
            constraint_overrides=data.get('constraint_overrides', {}),
            big_eaters=data.get('big_eaters', False),
            big_eaters_percentage=data.get('big_eaters_percentage', 20.0),
        )

        pdf_bytes = generate_portion_pdf(
            result=result,
            menu_name=data.get('menu_name', 'Custom Menu'),
            guests=data['guests'],
            event_date=data.get('date'),
        )

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = 'attachment; filename="portioning-sheet.pdf"'
        return response
