from django.contrib import admin
from .models import MenuTemplate, MenuDishPortion


class MenuDishPortionInline(admin.TabularInline):
    model = MenuDishPortion
    extra = 1
    autocomplete_fields = ['dish']


@admin.register(MenuTemplate)
class MenuTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'is_active', 'default_gents', 'default_ladies', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name']
    inlines = [MenuDishPortionInline]
