from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from bookings.models.settings import OrgSettings
from payments.models import Subscription

from .models import Organisation, User


# ── Inlines that turn the Organisation page into a one-stop hub ──
# Everything about an org (its users, billing, and settings) is managed here,
# instead of hunting across the separate top-level User / Subscription screens.

class OrgUserInlineForm(forms.ModelForm):
    """User row on the Organisation page. Adds a plain password field that hashes
    on save (Django won't let you set a usable password through a raw field)."""
    new_password = forms.CharField(
        required=False, widget=forms.PasswordInput(render_value=False),
        label="Set / reset password",
        help_text="Required for a new user; leave blank to keep an existing user's password.",
    )

    class Meta:
        model = User
        fields = ("email", "first_name", "last_name", "role", "is_active")

    def clean_new_password(self):
        pw = self.cleaned_data.get("new_password")
        # A brand-new user (no PK yet) must get a password, or they can't log in.
        if not self.instance.pk and not pw:
            raise forms.ValidationError("Set a password for the new user.")
        return pw

    def save(self, commit=True):
        user = super().save(commit=False)
        pw = self.cleaned_data.get("new_password")
        if pw:
            user.set_password(pw)
        if commit:
            user.save()
            self.save_m2m()
        return user


class OrgUserInline(admin.TabularInline):
    model = User
    form = OrgUserInlineForm
    fields = ("email", "first_name", "last_name", "role", "is_active", "new_password")
    extra = 0
    verbose_name = "user"
    verbose_name_plural = "Users (add / edit / remove — role & password here)"
    # is_staff/is_superuser deliberately excluded — grant those in the full User
    # admin so nobody accidentally hands out Django-admin/superuser from here.


class SubscriptionInline(admin.StackedInline):
    """Billing state for the org — comp, trial, and (crucially) the Stripe ids,
    which are EDITABLE here so a mode-crossed / stale customer can be cleared in
    place ('reset linkage'). The standalone Subscription admin keeps them
    read-only; this hub is the deliberate escape hatch."""
    model = Subscription
    extra = 0
    can_delete = False
    max_num = 1
    fields = (
        "status", "comped", "plan_name",
        "trial_ends_at", "current_period_end", "cancel_at_period_end",
        ("stripe_customer_id", "stripe_subscription_id"), "stripe_price_id",
    )
    readonly_fields = ("plan_name",)


class OrgSettingsInline(admin.StackedInline):
    """All org-level settings (currency, tax, service charge, timezone, commission…)
    in one place on the org page."""
    model = OrgSettings
    extra = 0
    can_delete = False
    max_num = 1


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ["name", "country", "is_active", "subscription_status", "created_at"]
    list_editable = ["is_active"]  # toggle active inline from the list
    list_filter = ["is_active", "country"]
    search_fields = ["name", "slug"]
    inlines = [OrgSettingsInline, SubscriptionInline, OrgUserInline]
    actions = ["activate_organisations", "deactivate_organisations", "seed_starter_catalog"]

    @admin.action(description="Seed starter catalog (dishes, menus, add-ons, rules)")
    def seed_starter_catalog(self, request, queryset):
        from dishes.management.commands.seed_starter_catalog import Command as SeedCatalog
        for org in queryset:
            SeedCatalog().seed(org)
        self.message_user(
            request,
            f"Seeded the starter catalog into {queryset.count()} organisation(s).",
        )

    @admin.display(description="Billing")
    def subscription_status(self, obj):
        sub = getattr(obj, "subscription", None)
        if sub is None:
            return "—"
        return "comped" if sub.comped else sub.get_status_display()

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
    list_filter = ["organisation", "role", "is_superuser", "is_staff", "is_active"]
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
            "fields": ("email", "first_name", "last_name", "role", "organisation", "password1", "password2"),
        }),
    )
