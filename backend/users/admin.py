from django.contrib import admin
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Organisation, User


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ["name", "created_at"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "first_name", "last_name", "role", "is_staff"]
    list_filter = ["role", "is_staff", "is_active"]
    search_fields = ["email", "first_name", "last_name"]
    ordering = ["email"]

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        ("Role", {"fields": ("role", "organisation", "product_lines")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    filter_horizontal = ["product_lines"]

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "first_name", "last_name", "role", "password1", "password2"),
        }),
    )
