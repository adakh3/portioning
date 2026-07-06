from django.contrib import admin
from django.contrib.admin.widgets import FilteredSelectMultiple
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Organisation, User


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ["name", "is_active", "created_at"]
    list_editable = ["is_active"]  # toggle active inline from the list
    list_filter = ["is_active"]
    search_fields = ["name", "slug"]
    actions = ["activate_organisations", "deactivate_organisations", "seed_starter_catalog"]

    @admin.action(description="Seed US starter catalog (dishes, menus, add-ons, rules)")
    def seed_starter_catalog(self, request, queryset):
        from django.core.management import call_command
        for org in queryset:
            call_command('seed_starter_catalog', org=org.name, verbosity=0)
        self.message_user(
            request,
            f"Seeded the US starter catalog into {queryset.count()} organisation(s).",
        )

    @admin.action(description="Activate selected organisations")
    def activate_organisations(self, request, queryset):
        updated = queryset.update(is_active=True)
        self.message_user(request, f"{updated} organisation(s) activated.")

    @admin.action(description="Deactivate selected organisations (hides from the app org switcher)")
    def deactivate_organisations(self, request, queryset):
        # Soft-disable: the switcher endpoint lists only is_active orgs, so this
        # removes them from the app without a hard delete (no FK-cascade risk).
        updated = queryset.update(is_active=False)
        self.message_user(request, f"{updated} organisation(s) deactivated.")


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ["email", "first_name", "last_name", "role", "organisation",
                    "is_staff", "is_superuser", "is_active"]
    list_filter = ["role", "organisation", "is_superuser", "is_staff", "is_active"]
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
