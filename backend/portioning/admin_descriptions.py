"""One-line descriptions shown under each model on the Django admin index.

Keyed by ``app_label.model_name`` (lowercase). Injected into the admin index via
a thin override of ``AdminSite.get_app_list``; rendered by templates/admin/app_list.html.
"""
from django.contrib import admin

DESCRIPTIONS = {
    # Bookings — CRM core
    "bookings.contact": "A customer (person) — the primary party a quote/event is for.",
    "bookings.account": "A business/company (optional) a booking can be attached to for B2B.",
    "bookings.lead": "An inbound enquiry, before it becomes a quote or event.",
    "bookings.quote": "A priced quotation for a customer; converts to an event when accepted.",
    "bookings.invoice": "Invoices raised against events.",
    "bookings.payment": "Payments received against invoices.",
    "bookings.venue": "Saved venues a booking can be held at (vs. a free-text address).",
    "bookings.reminder": "Follow-up reminders/tasks attached to leads.",
    "bookings.activitylog": "Audit trail of lead changes (status changes, edits).",
    "bookings.whatsappmessage": "WhatsApp message log for lead conversations.",
    "bookings.lockeddate": "Dates blocked from new bookings (fully booked / unavailable).",
    # Bookings — catalog & categorisation
    "bookings.addonproduct": "Priced catalog of add-on products/services (with variants) for quotes & events.",
    "bookings.productline": "Business/service lines (e.g. Weddings) — a calendar colour + round-robin lead assignment.",
    # Bookings — choice option lists (configure the dropdowns used across the app)
    "bookings.eventtypeoption": "Selectable event types (wedding, corporate…).",
    "bookings.mealtypeoption": "Selectable meal types (lunch, dinner…).",
    "bookings.servicestyleoption": "Selectable service styles (buffet, plated…).",
    "bookings.sourceoption": "Where leads come from (website, referral…).",
    "bookings.leadstatusoption": "The lead pipeline stages (new, contacted, won…).",
    "bookings.lostreasonoption": "Reasons a lead was marked lost.",
    # Bookings — settings
    "bookings.orgsettings": "Per-organisation config (pricing rounding, tax, defaults).",
    "bookings.sitesettings": "Global branding and quotation terms.",
    # Dishes / menus
    "dishes.dishcategory": "Categories that group dishes (mains, desserts…) with portioning pools.",
    "dishes.dish": "A menu dish with portion sizes and cost/price data.",
    "menus.menutemplate": "Reusable menu templates with tiered per-head pricing.",
    # Equipment (physical inventory — distinct from priced add-ons)
    "equipment.equipmentitem": "Physical equipment inventory with stock levels.",
    "equipment.equipmentreservation": "Allocations of equipment to specific events.",
    # Events
    "events.event": "A confirmed booking with menu, add-ons, staffing and logistics.",
    # Staff
    "staff.laborrole": "Staff roles with hourly rates, for event labour costing.",
    "staff.staffmember": "Your staff, assignable to event shifts.",
    "staff.allocationrule": "Rules for how many staff an event needs.",
    # Users / tenancy
    "users.organisation": "Tenant organisations — each is an isolated workspace.",
    "users.user": "Login accounts and their roles.",
    # Rules (portioning engine config)
    "rules.globalconfig": "Global knobs for the portioning engine.",
    "rules.globalconstraint": "Hard limits the portioning engine must respect.",
    "rules.guestprofile": "Per-guest-type portion multipliers (e.g. ladies eat less).",
    "rules.budgetprofile": "Per-category food budgets the engine allocates against.",
}


_original_get_app_list = admin.AdminSite.get_app_list


def _get_app_list_with_descriptions(self, request, app_label=None):
    app_list = _original_get_app_list(self, request, app_label)
    for app in app_list:
        for model in app.get("models", []):
            klass = model.get("model")
            if klass is not None:
                desc = DESCRIPTIONS.get(klass._meta.label_lower)
                if desc:
                    model["description"] = desc
    return app_list


admin.AdminSite.get_app_list = _get_app_list_with_descriptions


# Show the same one-liner under the heading on each model's changelist page.
# Django's base.html renders `subtitle` as an <h2> right after the <h1> title.
_original_changelist_view = admin.ModelAdmin.changelist_view


def _changelist_view_with_description(self, request, extra_context=None):
    desc = DESCRIPTIONS.get(self.model._meta.label_lower)
    if desc:
        extra_context = {**(extra_context or {}), "subtitle": desc}
    return _original_changelist_view(self, request, extra_context)


admin.ModelAdmin.changelist_view = _changelist_view_with_description
