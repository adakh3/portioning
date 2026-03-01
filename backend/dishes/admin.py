from django.contrib import admin
from .models import DishCategory, Dish


@admin.register(DishCategory)
class DishCategoryAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'name', 'pool', 'unit', 'display_order',
                    'baseline_budget_grams', 'min_per_dish_grams', 'fixed_portion_grams',
                    'protein_is_additive', 'addition_surcharge', 'removal_discount']
    list_editable = ['display_order', 'baseline_budget_grams', 'min_per_dish_grams',
                     'fixed_portion_grams', 'protein_is_additive',
                     'addition_surcharge', 'removal_discount']
    list_filter = ['pool', 'unit']
    ordering = ['display_order']


@admin.register(Dish)
class DishAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'protein_type', 'default_portion_grams',
                    'popularity', 'cost_per_gram', 'selling_price_per_gram',
                    'selling_price_override', 'addition_surcharge', 'removal_discount',
                    'surcharge_override', 'is_vegetarian', 'is_active']
    list_filter = ['category', 'protein_type', 'is_vegetarian', 'is_active',
                   'selling_price_override', 'surcharge_override']
    search_fields = ['name']
    list_editable = ['popularity', 'selling_price_per_gram',
                     'addition_surcharge', 'removal_discount',
                     'surcharge_override', 'is_active']
    actions = ['recalculate_selling_prices', 'recalculate_surcharges']

    @admin.action(description='Recalculate selling prices (non-overridden dishes)')
    def recalculate_selling_prices(self, request, queryset):
        from bookings.models import SiteSettings
        from decimal import Decimal
        settings = SiteSettings.load()
        if not settings.target_food_cost_percentage:
            self.message_user(request, 'Target food cost percentage is not set.', level='error')
            return
        dishes = queryset.filter(selling_price_override=False).exclude(cost_per_gram=0)
        divisor = settings.target_food_cost_percentage / Decimal('100')
        updated = 0
        for dish in dishes:
            dish.selling_price_per_gram = dish.cost_per_gram / divisor
            dish.save(update_fields=['selling_price_per_gram'])
            updated += 1
        self.message_user(request, f'Recalculated selling prices for {updated} dish(es).')

    @admin.action(description='Recalculate surcharges (non-overridden dishes)')
    def recalculate_surcharges(self, request, queryset):
        from decimal import Decimal
        dishes = queryset.filter(surcharge_override=False).select_related('category')
        updated = 0
        for dish in dishes:
            if not dish.selling_price_per_gram:
                continue
            portion = Decimal(str(dish.category.baseline_budget_grams))
            surcharge = (portion * dish.selling_price_per_gram).quantize(Decimal('0.01'))
            dish.addition_surcharge = surcharge
            dish.removal_discount = (surcharge / 2).quantize(Decimal('0.01'))
            dish.save(update_fields=['addition_surcharge', 'removal_discount'])
            updated += 1
        self.message_user(request, f'Recalculated surcharges for {updated} dish(es).')
