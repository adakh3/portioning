from django.contrib import admin

from .models import (
    Account, Contact, Venue, Lead, Quote, QuoteLineItem,
    LaborRole, StaffMember, Shift,
    EquipmentItem, EquipmentReservation,
    Invoice, Payment,
    BudgetRangeOption, SiteSettings,
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

@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ['contact_name', 'event_type', 'event_date', 'status', 'source', 'guest_estimate', 'created_at']
    list_filter = ['status', 'source', 'event_type']
    search_fields = ['contact_name', 'contact_email', 'account__name']
    readonly_fields = ['converted_to_quote', 'contacted_at', 'qualified_at', 'converted_at', 'lost_at']


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
