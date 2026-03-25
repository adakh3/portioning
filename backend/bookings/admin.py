import json
from dataclasses import asdict

from django.contrib import admin
from django.shortcuts import render, redirect
from django.urls import path, reverse
from django.contrib import messages
from django.http import FileResponse
from django.contrib.staticfiles import finders

from users.models import User
from .models import (
    Account, Contact, Venue, Lead, ProductLine, Quote, QuoteLineItem,
    Invoice, Payment,
    SiteSettings, OrgSettings,
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
    LostReasonOption, MealTypeOption, ArrangementTypeOption, BeverageTypeOption,
    ActivityLog,
    Reminder,
    WhatsAppMessage,
    LockedDate,
)
from .services.lead_import import (
    load_xlsx, load_csv, parse_rows, validate_rows, flag_duplicates, commit_rows, ImportRow,
)


# --- Org-scoped admin mixin ---

class OrgScopedAdmin(admin.ModelAdmin):
    """Base admin that scopes querysets to the logged-in user's org (unless superuser)."""
    org_field = 'organisation'

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if request.user.is_superuser:
            return qs
        org = getattr(request.user, 'organisation', None)
        if org:
            return qs.filter(**{self.org_field: org})
        return qs.none()

    def save_model(self, request, obj, form, change):
        if not change and not getattr(obj, self.org_field, None):
            setattr(obj, self.org_field, request.user.organisation)
        super().save_model(request, obj, form, change)


# --- Accounts & Contacts ---

class ContactInline(admin.TabularInline):
    model = Contact
    extra = 1


@admin.register(Account)
class AccountAdmin(OrgScopedAdmin):
    list_display = ['name', 'account_type', 'billing_city', 'payment_terms', 'created_at']
    list_filter = ['account_type', 'payment_terms']
    search_fields = ['name', 'vat_number']
    inlines = [ContactInline]


@admin.register(Contact)
class ContactAdmin(OrgScopedAdmin):
    org_field = 'account__organisation'

    list_display = ['name', 'account', 'role', 'email', 'phone', 'is_primary']
    list_filter = ['role', 'is_primary']
    search_fields = ['name', 'email', 'account__name']


# --- Venues ---

@admin.register(Venue)
class VenueAdmin(OrgScopedAdmin):
    list_display = ['name', 'city', 'kitchen_access', 'contact_name']
    list_filter = ['kitchen_access']
    search_fields = ['name', 'city']


# --- Leads ---

@admin.register(ProductLine)
class ProductLineAdmin(OrgScopedAdmin):
    list_display = ['name', 'organisation', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name']


@admin.register(Lead)
class LeadAdmin(OrgScopedAdmin):
    list_display = ['contact_name', 'event_type', 'event_date', 'lead_date', 'status', 'product', 'assigned_to', 'source', 'guest_estimate', 'created_at']
    list_select_related = ['product', 'assigned_to', 'organisation']
    list_filter = ['status', 'source', 'event_type', 'product']
    search_fields = ['contact_name', 'contact_email', 'account__name']
    readonly_fields = ['won_quote', 'won_event', 'contacted_at', 'qualified_at', 'proposal_sent_at', 'won_at', 'lost_at']
    change_list_template = "admin/bookings/lead/change_list.html"

    def get_urls(self):
        custom_urls = [
            path(
                "import/",
                self.admin_site.admin_view(self.import_view),
                name="bookings_lead_import",
            ),
            path(
                "import/template/",
                self.admin_site.admin_view(self.download_template),
                name="bookings_lead_import_template",
            ),
            path(
                "import/confirm/",
                self.admin_site.admin_view(self.import_confirm_view),
                name="bookings_lead_import_confirm",
            ),
        ]
        return custom_urls + super().get_urls()

    def import_view(self, request):
        """GET: show upload form. POST: parse file and show preview."""
        org = request.user.organisation
        context = {
            **self.admin_site.each_context(request),
            "products": list(ProductLine.objects.filter(organisation=org, is_active=True).values_list('name', flat=True)),
            "event_types": EventTypeOption.objects.filter(organisation=org, is_active=True).order_by('sort_order').values_list('value', flat=True),
            "sources": SourceOption.objects.filter(organisation=org, is_active=True).order_by('sort_order').values_list('value', flat=True),
            "service_styles": ServiceStyleOption.objects.filter(organisation=org, is_active=True).order_by('sort_order').values_list('value', flat=True),
            "lead_statuses": LeadStatusOption.objects.filter(organisation=org, is_active=True).order_by('sort_order').values_list('value', flat=True),
            "meal_types": MealTypeOption.objects.filter(organisation=org, is_active=True).order_by('sort_order').values_list('value', flat=True),
            "date_format": org.settings.date_format if hasattr(org, 'settings') else 'DD/MM/YYYY',
        }

        if request.method != "POST":
            return render(request, "admin/bookings/lead/import_form.html", context)

        uploaded = request.FILES.get("file")
        if not uploaded:
            context["errors"] = ["Please select a file to upload."]
            return render(request, "admin/bookings/lead/import_form.html", context)

        # Validate file size (max 10 MB)
        if uploaded.size > 10 * 1024 * 1024:
            context["errors"] = ["File too large. Maximum size is 10 MB."]
            return render(request, "admin/bookings/lead/import_form.html", context)

        sheet_name = request.POST.get("sheet_name", "").strip() or None
        product_id = request.POST.get("product_id", "").strip() or None
        assigned_to_id = request.POST.get("assigned_to_id", "").strip() or None

        filename = uploaded.name.lower()
        try:
            if filename.endswith(".csv"):
                header, data_rows, _ = load_csv(uploaded)
            elif filename.endswith(".xlsx"):
                header, data_rows, sheet_names = load_xlsx(uploaded, sheet_name)
            else:
                context["errors"] = ["Unsupported file type. Please upload .xlsx or .csv."]
                return render(request, "admin/bookings/lead/import_form.html", context)

            if not header:
                context["errors"] = ["The file appears to be empty."]
                return render(request, "admin/bookings/lead/import_form.html", context)

            import_rows = parse_rows(data_rows, header)
            validate_rows(import_rows, org)
            flag_duplicates(import_rows, org)
        except ValueError as e:
            context["errors"] = [str(e)]
            return render(request, "admin/bookings/lead/import_form.html", context)
        except (OSError, UnicodeDecodeError, KeyError) as e:
            context["errors"] = ["Error reading file. Please check the format and try again."]
            return render(request, "admin/bookings/lead/import_form.html", context)

        # Store parsed data in session for confirm step
        rows_data = []
        for r in import_rows:
            d = asdict(r)
            # Convert dates to string for JSON serialization
            if d["event_date"]:
                d["event_date"] = str(d["event_date"])
            if d["lead_date"]:
                d["lead_date"] = str(d["lead_date"])
            rows_data.append(d)

        request.session["import_rows"] = json.dumps(rows_data)
        request.session["import_product_id"] = product_id
        request.session["import_assigned_to_id"] = assigned_to_id

        # Compute summary counts
        valid_count = sum(1 for r in import_rows if not r.skipped and not r.error)
        skipped_count = sum(1 for r in import_rows if r.skipped)
        error_count = sum(1 for r in import_rows if r.error)
        duplicate_count = sum(1 for r in import_rows if r.duplicate_warning)

        # Look up names for display
        product_name = ""
        assigned_name = ""
        if product_id:
            try:
                product_name = ProductLine.objects.get(pk=product_id).name
            except ProductLine.DoesNotExist:
                pass
        if assigned_to_id:
            try:
                u = User.objects.get(pk=assigned_to_id)
                assigned_name = u.get_full_name() or u.email
            except User.DoesNotExist:
                pass

        context.update({
            "rows": import_rows,
            "valid_count": valid_count,
            "skipped_count": skipped_count,
            "error_count": error_count,
            "duplicate_count": duplicate_count,
            "product_name": product_name,
            "assigned_name": assigned_name,
        })
        return render(request, "admin/bookings/lead/import_preview.html", context)

    def import_confirm_view(self, request):
        """POST: commit parsed rows from session to DB."""
        if request.method != "POST":
            return redirect(reverse("admin:bookings_lead_import"))

        rows_json = request.session.pop("import_rows", None)
        # Clear legacy session keys if present
        request.session.pop("import_product_id", None)
        request.session.pop("import_assigned_to_id", None)

        if not rows_json:
            messages.error(request, "No import data found. Please upload a file again.")
            return redirect(reverse("admin:bookings_lead_import"))

        rows_data = json.loads(rows_json)
        import_rows = []
        for d in rows_data:
            # Reconstruct dates
            from datetime import date
            if d["event_date"]:
                parts = d["event_date"].split("-")
                d["event_date"] = date(int(parts[0]), int(parts[1]), int(parts[2]))
            if d["lead_date"]:
                parts = d["lead_date"].split("-")
                d["lead_date"] = date(int(parts[0]), int(parts[1]), int(parts[2]))
            import_rows.append(ImportRow(**d))

        org = request.user.organisation
        created_count, errors = commit_rows(import_rows, org)
        skipped_count = sum(1 for r in import_rows if r.skipped)
        error_count = len(errors)

        context = {
            **self.admin_site.each_context(request),
            "created_count": created_count,
            "skipped_count": skipped_count,
            "error_count": error_count,
            "errors": errors,
        }
        return render(request, "admin/bookings/lead/import_results.html", context)

    def download_template(self, request):
        """Serve the CSV template file as a download."""
        file_path = finders.find("bookings/leads_import_template.csv")
        return FileResponse(
            open(file_path, "rb"),
            content_type="text/csv",
            as_attachment=True,
            filename="leads_import_template.csv",
        )


# --- Quotes ---

class QuoteLineItemInline(admin.TabularInline):
    model = QuoteLineItem
    extra = 1
    fields = ['category', 'description', 'quantity', 'unit', 'unit_price', 'is_taxable', 'line_total', 'sort_order']
    readonly_fields = ['line_total']


@admin.register(Quote)
class QuoteAdmin(OrgScopedAdmin):
    list_display = ['__str__', 'account', 'event_date', 'guest_count', 'total', 'status', 'created_at']
    list_filter = ['status', 'event_type']
    search_fields = ['account__name']
    readonly_fields = ['subtotal', 'tax_amount', 'total', 'sent_at', 'accepted_at']
    inlines = [QuoteLineItemInline]


# --- Finance ---

class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(OrgScopedAdmin):
    org_field = 'event__organisation'

    list_display = ['invoice_number', 'event', 'invoice_type', 'total', 'status', 'due_date']
    list_filter = ['status', 'invoice_type']
    search_fields = ['invoice_number', 'event__name']
    readonly_fields = ['sent_at', 'paid_at']
    inlines = [PaymentInline]


@admin.register(Payment)
class PaymentAdmin(OrgScopedAdmin):
    org_field = 'invoice__event__organisation'

    list_display = ['invoice', 'amount', 'payment_date', 'method', 'reference']
    list_filter = ['method']
    search_fields = ['invoice__invoice_number', 'reference']


# --- Choice Options ---

@admin.register(EventTypeOption)
class EventTypeOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(SourceOption)
class SourceOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(ServiceStyleOption)
class ServiceStyleOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(LeadStatusOption)
class LeadStatusOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(LostReasonOption)
class LostReasonOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(MealTypeOption)
class MealTypeOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(ArrangementTypeOption)
class ArrangementTypeOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(BeverageTypeOption)
class BeverageTypeOptionAdmin(OrgScopedAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


# --- Activity Log ---

@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'action', 'content_type', 'object_id', 'field_name', 'user', 'description']
    list_filter = ['action', 'content_type']
    search_fields = ['description', 'field_name']
    readonly_fields = ['content_type', 'object_id', 'action', 'field_name', 'old_value', 'new_value', 'description', 'user', 'created_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


# --- Reminders ---

@admin.register(Reminder)
class ReminderAdmin(OrgScopedAdmin):
    org_field = 'lead__organisation'

    list_display = ['lead', 'user', 'due_at', 'status', 'note', 'created_at']
    list_filter = ['status', 'user']
    search_fields = ['note', 'lead__contact_name']
    readonly_fields = ['created_at', 'updated_at']


# --- Settings ---

@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    list_display = ['currency_symbol', 'currency_code', 'target_food_cost_percentage']

    def has_add_permission(self, request):
        # Only allow one instance
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(OrgSettings)
class OrgSettingsAdmin(admin.ModelAdmin):
    list_display = ['organisation', 'whatsapp_enabled', 'twilio_whatsapp_number', 'twilio_configured']
    readonly_fields = ['twilio_configured']
    fieldsets = (
        (None, {
            'fields': ('organisation', 'currency_symbol', 'currency_code', 'date_format', 'timezone'),
        }),
        ('Pricing', {
            'fields': ('tax_label', 'default_tax_rate', 'default_price_per_head', 'target_food_cost_percentage', 'price_rounding_step'),
        }),
        ('WhatsApp / Twilio', {
            'fields': ('whatsapp_enabled', 'twilio_account_sid', 'twilio_auth_token_encrypted', 'twilio_whatsapp_number', 'twilio_configured'),
            'description': 'Configure Twilio credentials to enable WhatsApp for this organisation.',
        }),
    )

    def twilio_configured(self, obj):
        return obj.twilio_configured
    twilio_configured.boolean = True


# --- WhatsApp Messages ---

@admin.register(WhatsAppMessage)
class WhatsAppMessageAdmin(OrgScopedAdmin):
    list_display = ['to_phone', 'lead', 'direction', 'status', 'sent_by', 'created_at']
    list_filter = ['status', 'direction']
    search_fields = ['to_phone', 'body', 'twilio_sid', 'lead__contact_name']
    readonly_fields = ['twilio_sid', 'created_at', 'updated_at']


# --- Locked Dates ---

@admin.register(LockedDate)
class LockedDateAdmin(OrgScopedAdmin):
    list_display = ['date', 'reason', 'locked_by', 'organisation', 'created_at']
    list_filter = ['organisation']
    search_fields = ['reason']
    readonly_fields = ['created_at']
