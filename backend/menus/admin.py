from django.contrib import admin
from users.admin_mixins import OrgVisibleAdminMixin
from .models import MenuTemplate, MenuDishPortion, MenuTemplatePriceTier, MenuCourse


class MenuCourseInline(admin.TabularInline):
    """Courses (Starter/Entrée/Dessert + service style) defined on a template (REL-417);
    dishes are assigned to them via the portion's course field below."""
    model = MenuCourse
    extra = 0


class MenuDishPortionInline(admin.TabularInline):
    model = MenuDishPortion
    extra = 1
    autocomplete_fields = ['dish']
    fields = ['dish', 'portion_grams', 'course']  # course-per-dish assignment (REL-417)


class MenuTemplatePriceTierInline(admin.TabularInline):
    model = MenuTemplatePriceTier
    extra = 1


@admin.register(MenuTemplate)
class MenuTemplateAdmin(OrgVisibleAdminMixin, admin.ModelAdmin):
    list_display = ['name', 'menu_type', 'is_active', 'default_gents', 'default_ladies', 'created_at']
    list_filter = ['is_active', 'menu_type']
    search_fields = ['name']
    inlines = [MenuTemplatePriceTierInline, MenuCourseInline, MenuDishPortionInline]
