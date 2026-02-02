from django.contrib import admin
from .models import DishCategory, Dish


@admin.register(DishCategory)
class DishCategoryAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'name', 'pool', 'unit', 'display_order',
                    'baseline_budget_grams', 'min_per_dish_grams', 'fixed_portion_grams',
                    'protein_is_additive']
    list_editable = ['display_order', 'baseline_budget_grams', 'min_per_dish_grams',
                     'fixed_portion_grams', 'protein_is_additive']
    list_filter = ['pool', 'unit']
    ordering = ['display_order']


@admin.register(Dish)
class DishAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'protein_type', 'default_portion_grams',
                    'popularity', 'cost_per_gram', 'is_vegetarian', 'is_active']
    list_filter = ['category', 'protein_type', 'is_vegetarian', 'is_active']
    search_fields = ['name']
    list_editable = ['popularity', 'is_active']
