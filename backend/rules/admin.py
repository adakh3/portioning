from django.contrib import admin
from .models import (
    GlobalConfig, BudgetProfile, GuestProfile,
    CombinationRule, GlobalConstraint, CategoryConstraint,
)


@admin.register(GlobalConfig)
class GlobalConfigAdmin(admin.ModelAdmin):
    list_display = ['organisation', 'popularity_enabled', 'popularity_strength',
                    'protein_pool_ceiling_grams', 'dessert_pool_ceiling_grams',
                    'dish_growth_rate', 'absent_redistribution_fraction']


@admin.register(BudgetProfile)
class BudgetProfileAdmin(admin.ModelAdmin):
    list_display = ['name', 'organisation', 'protein_pool_ceiling_grams', 'dessert_pool_ceiling_grams', 'is_default']
    list_editable = ['is_default']
    filter_horizontal = ['categories']


@admin.register(GuestProfile)
class GuestProfileAdmin(admin.ModelAdmin):
    list_display = ['name', 'organisation', 'portion_multiplier']
    list_editable = ['portion_multiplier']


@admin.register(CombinationRule)
class CombinationRuleAdmin(admin.ModelAdmin):
    list_display = ['description', 'organisation', 'reduction_factor', 'is_active']
    list_editable = ['is_active']
    filter_horizontal = ['categories']


@admin.register(GlobalConstraint)
class GlobalConstraintAdmin(admin.ModelAdmin):
    list_display = ['organisation', 'max_total_food_per_person_grams', 'min_portion_per_dish_grams']


@admin.register(CategoryConstraint)
class CategoryConstraintAdmin(admin.ModelAdmin):
    list_display = ['category', 'min_portion_grams', 'max_portion_grams', 'max_total_category_grams']
