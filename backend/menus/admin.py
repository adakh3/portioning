from django.contrib import admin
from .models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier


class MenuDishPortionInline(admin.TabularInline):
    model = MenuDishPortion
    extra = 1
    autocomplete_fields = ['dish']


class MenuTemplatePriceTierInline(admin.TabularInline):
    model = MenuTemplatePriceTier
    extra = 1


@admin.register(MenuTemplate)
class MenuTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'menu_type', 'is_active', 'default_gents', 'default_ladies', 'created_at']
    list_filter = ['is_active', 'menu_type']
    search_fields = ['name']
    inlines = [MenuTemplatePriceTierInline, MenuDishPortionInline]
