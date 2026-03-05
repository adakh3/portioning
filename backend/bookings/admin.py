import json
from dataclasses import asdict

from django.contrib import admin
from django.shortcuts import render, redirect
from django.urls import path, reverse
from django.contrib import messages

from users.models import User
from .models import (
    Account, Contact, Venue, Lead, ProductLine, Quote, QuoteLineItem,
    LaborRole, StaffMember, Shift,
    EquipmentItem, EquipmentReservation,
    Invoice, Payment,
    BudgetRangeOption, SiteSettings,
    EventTypeOption, SourceOption, ServiceStyleOption, LeadStatusOption,
)
from .services.lead_import import (
    load_xlsx, load_csv, parse_rows, flag_duplicates, commit_rows, ImportRow,
)


# --- Accounts & Contacts ---

class ContactInline(admin.TabularInline):
    model = Contact
    extra = 1


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = ['name', 'account_type', 'billing_city', 'payment_terms', 'created_at']
    list_filter = ['account_type', 'payment_terms']
    search_fields = ['name', 'vat_number']
    inlines = [ContactInline]


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ['name', 'account', 'role', 'email', 'phone', 'is_primary']
    list_filter = ['role', 'is_primary']
    search_fields = ['name', 'email', 'account__name']


# --- Venues ---

@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ['name', 'city', 'kitchen_access', 'contact_name']
    list_filter = ['kitchen_access']
    search_fields = ['name', 'city']


# --- Leads ---

@admin.register(ProductLine)
class ProductLineAdmin(admin.ModelAdmin):
    list_display = ['name', 'organisation', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name']


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ['contact_name', 'event_type', 'event_date', 'lead_date', 'status', 'product', 'assigned_to', 'source', 'guest_estimate', 'created_at']
    list_filter = ['status', 'source', 'event_type', 'product']
    search_fields = ['contact_name', 'contact_email', 'account__name']
    readonly_fields = ['converted_to_quote', 'contacted_at', 'qualified_at', 'converted_at', 'lost_at']
    change_list_template = "admin/bookings/lead/change_list.html"

    def get_urls(self):
        custom_urls = [
            path(
                "import/",
                self.admin_site.admin_view(self.import_view),
                name="bookings_lead_import",
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
        context = {
            **self.admin_site.each_context(request),
            "products": ProductLine.objects.filter(is_active=True),
            "users": User.objects.filter(is_active=True),
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
            flag_duplicates(import_rows)
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
        product_id = request.session.pop("import_product_id", None)
        assigned_to_id = request.session.pop("import_assigned_to_id", None)

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

        product = None
        if product_id:
            try:
                product = ProductLine.objects.get(pk=product_id)
            except ProductLine.DoesNotExist:
                pass

        assigned_to = None
        if assigned_to_id:
            try:
                assigned_to = User.objects.get(pk=assigned_to_id)
            except User.DoesNotExist:
                pass

        created_count, errors = commit_rows(import_rows, product, assigned_to)
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


# --- Quotes ---

class QuoteLineItemInline(admin.TabularInline):
    model = QuoteLineItem
    extra = 1
    fields = ['category', 'description', 'quantity', 'unit', 'unit_price', 'is_taxable', 'line_total', 'sort_order']
    readonly_fields = ['line_total']


@admin.register(Quote)
class QuoteAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'account', 'event_date', 'guest_count', 'total', 'status', 'created_at']
    list_filter = ['status', 'event_type']
    search_fields = ['account__name']
    readonly_fields = ['subtotal', 'tax_amount', 'total', 'sent_at', 'accepted_at']
    inlines = [QuoteLineItemInline]


# --- Staffing ---

@admin.register(LaborRole)
class LaborRoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'default_hourly_rate', 'is_active']
    list_filter = ['is_active']


@admin.register(StaffMember)
class StaffMemberAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'phone', 'is_active']
    list_filter = ['is_active', 'roles']
    search_fields = ['name', 'email']
    filter_horizontal = ['roles']


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ['event', 'role', 'staff_member', 'start_time', 'end_time', 'status']
    list_filter = ['status', 'role']
    search_fields = ['event__name', 'staff_member__name']


# --- Equipment ---

@admin.register(EquipmentItem)
class EquipmentItemAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'stock_quantity', 'rental_price', 'is_active']
    list_filter = ['category', 'is_active']
    search_fields = ['name']


@admin.register(EquipmentReservation)
class EquipmentReservationAdmin(admin.ModelAdmin):
    list_display = ['event', 'equipment', 'quantity_out', 'quantity_returned', 'return_condition']
    list_filter = ['return_condition']
    search_fields = ['event__name', 'equipment__name']


# --- Finance ---

class PaymentInline(admin.TabularInline):
    model = Payment
    extra = 0


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
    list_display = ['invoice_number', 'event', 'invoice_type', 'total', 'status', 'due_date']
    list_filter = ['status', 'invoice_type']
    search_fields = ['invoice_number', 'event__name']
    readonly_fields = ['sent_at', 'paid_at']
    inlines = [PaymentInline]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ['invoice', 'amount', 'payment_date', 'method', 'reference']
    list_filter = ['method']
    search_fields = ['invoice__invoice_number', 'reference']


# --- Choice Options ---

@admin.register(EventTypeOption)
class EventTypeOptionAdmin(admin.ModelAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(SourceOption)
class SourceOptionAdmin(admin.ModelAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(ServiceStyleOption)
class ServiceStyleOptionAdmin(admin.ModelAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(LeadStatusOption)
class LeadStatusOptionAdmin(admin.ModelAdmin):
    list_display = ['value', 'label', 'sort_order', 'is_active']
    list_editable = ['label', 'sort_order', 'is_active']
    ordering = ['sort_order']


# --- Settings ---

@admin.register(BudgetRangeOption)
class BudgetRangeOptionAdmin(admin.ModelAdmin):
    list_display = ['label', 'sort_order', 'is_active']
    list_editable = ['sort_order', 'is_active']
    ordering = ['sort_order']


@admin.register(SiteSettings)
class SiteSettingsAdmin(admin.ModelAdmin):
    list_display = ['currency_symbol', 'currency_code', 'target_food_cost_percentage']

    def has_add_permission(self, request):
        # Only allow one instance
        return not SiteSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
