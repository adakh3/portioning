from django.urls import path

from bookings.views import (
    AccountListCreateView, AccountDetailView,
    ContactListCreateView, ContactDetailView,
    CustomerListCreateView, CustomerDetailView,
    VenueListCreateView, VenueDetailView,
    UserListView, ProductLineListView, ProductLineDetailView, ProductLineManageListCreateView, ProductLineManageDetailView, LeadListCreateView, LeadDetailView, LeadTransitionView, LeadCreateQuoteView, LeadWonView, LeadCreateEventView, LeadBulkUpdateView, LeadActivityView, LeadAutoAssignView, LeadKanbanView,
    DashboardStatsView, MyDashboardStatsView,
    MyCommissionView,
    CommissionBandManageListCreateView, CommissionBandManageDetailView,
    SalesTargetManageView,
    QuoteListCreateView, QuoteDetailView, QuoteTransitionView,
    QuoteLineItemListCreateView, QuoteLineItemDetailView,
    QuotePDFView,
    InvoiceListCreateView, InvoiceDetailView,
    PaymentListCreateView, PaymentDetailView,
    SiteSettingsView,
    EventTypeOptionListView, SourceOptionListView,
    ServiceStyleOptionListView, LeadStatusOptionListView,
    LeadStatusManageListCreateView, LeadStatusManageDetailView,
    LostReasonOptionListView, MealTypeOptionListView,
    EventTypeManageListCreateView, EventTypeManageDetailView,
    SourceManageListCreateView, SourceManageDetailView,
    ServiceStyleManageListCreateView, ServiceStyleManageDetailView,
    MealTypeManageListCreateView, MealTypeManageDetailView,
    LostReasonManageListCreateView, LostReasonManageDetailView,
    AddOnProductListView,
    ReminderListCreateView, ReminderDetailView,
    LeadReminderListCreateView, ReminderCountsView,
    WhatsAppMessageListView, WhatsAppSendView, WhatsAppMarkReadView, TwilioWebhookView,
    LockedDateListCreateView, LockedDateDeleteView,
)

urlpatterns = [
    # Accounts (businesses) & Contacts (people)
    path('bookings/accounts/', AccountListCreateView.as_view(), name='account-list'),
    path('bookings/accounts/<int:pk>/', AccountDetailView.as_view(), name='account-detail'),
    path('bookings/accounts/<int:account_pk>/contacts/', ContactListCreateView.as_view(), name='contact-list'),
    path('bookings/accounts/<int:account_pk>/contacts/<int:pk>/', ContactDetailView.as_view(), name='contact-detail'),
    # Top-level customers (people), selectable independently of a business
    path('bookings/contacts/', CustomerListCreateView.as_view(), name='customer-list'),
    path('bookings/contacts/<int:pk>/', CustomerDetailView.as_view(), name='customer-detail'),

    # Venues
    path('bookings/venues/', VenueListCreateView.as_view(), name='venue-list'),
    path('bookings/venues/<int:pk>/', VenueDetailView.as_view(), name='venue-detail'),

    # Users (for assignment dropdowns)
    path('bookings/users/', UserListView.as_view(), name='user-list'),

    # Product Lines & Leads
    path('bookings/product-lines/', ProductLineListView.as_view(), name='product-line-list'),
    path('bookings/product-lines/<int:pk>/', ProductLineDetailView.as_view(), name='product-line-detail'),
    path('bookings/settings/product-lines/', ProductLineManageListCreateView.as_view(), name='product-line-manage-list'),
    path('bookings/settings/product-lines/<int:pk>/', ProductLineManageDetailView.as_view(), name='product-line-manage-detail'),
    path('bookings/leads/', LeadListCreateView.as_view(), name='lead-list'),
    path('bookings/leads/kanban/', LeadKanbanView.as_view(), name='lead-kanban'),
    path('bookings/leads/auto-assign/', LeadAutoAssignView.as_view(), name='lead-auto-assign'),
    path('bookings/leads/bulk/', LeadBulkUpdateView.as_view(), name='lead-bulk-update'),
    path('bookings/leads/<int:pk>/', LeadDetailView.as_view(), name='lead-detail'),
    path('bookings/leads/<int:pk>/transition/', LeadTransitionView.as_view(), name='lead-transition'),
    path('bookings/leads/<int:pk>/convert/', LeadCreateQuoteView.as_view(), name='lead-convert'),
    path('bookings/leads/<int:pk>/create-quote/', LeadCreateQuoteView.as_view(), name='lead-create-quote'),
    path('bookings/leads/<int:pk>/won/', LeadWonView.as_view(), name='lead-won'),
    path('bookings/leads/<int:pk>/create-event/', LeadCreateEventView.as_view(), name='lead-create-event'),
    path('bookings/leads/<int:pk>/activity/', LeadActivityView.as_view(), name='lead-activity'),
    path('bookings/leads/<int:pk>/reminders/', LeadReminderListCreateView.as_view(), name='lead-reminder-list'),

    # Reminders
    path('bookings/reminders/', ReminderListCreateView.as_view(), name='reminder-list'),
    path('bookings/reminders/counts/', ReminderCountsView.as_view(), name='reminder-counts'),
    path('bookings/reminders/<int:pk>/', ReminderDetailView.as_view(), name='reminder-detail'),

    # Dashboard
    path('bookings/dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('bookings/dashboard/my-stats/', MyDashboardStatsView.as_view(), name='my-dashboard-stats'),
    path('bookings/commission/me/', MyCommissionView.as_view(), name='my-commission'),
    path('bookings/settings/commission-bands/', CommissionBandManageListCreateView.as_view(), name='commission-band-list'),
    path('bookings/settings/commission-bands/<int:pk>/', CommissionBandManageDetailView.as_view(), name='commission-band-detail'),
    path('bookings/settings/sales-targets/', SalesTargetManageView.as_view(), name='sales-target-manage'),

    # Quotes & Line Items
    path('bookings/quotes/', QuoteListCreateView.as_view(), name='quote-list'),
    path('bookings/quotes/<int:pk>/', QuoteDetailView.as_view(), name='quote-detail'),
    path('bookings/quotes/<int:pk>/transition/', QuoteTransitionView.as_view(), name='quote-transition'),
    path('bookings/quotes/<int:pk>/pdf/', QuotePDFView.as_view(), name='quote-pdf'),
    path('bookings/quotes/<int:quote_pk>/items/', QuoteLineItemListCreateView.as_view(), name='quote-item-list'),
    path('bookings/quotes/<int:quote_pk>/items/<int:pk>/', QuoteLineItemDetailView.as_view(), name='quote-item-detail'),

    # Finance
    path('bookings/invoices/', InvoiceListCreateView.as_view(), name='invoice-list'),
    path('bookings/invoices/<int:pk>/', InvoiceDetailView.as_view(), name='invoice-detail'),
    path('bookings/invoices/<int:invoice_pk>/payments/', PaymentListCreateView.as_view(), name='payment-list'),
    path('bookings/invoices/<int:invoice_pk>/payments/<int:pk>/', PaymentDetailView.as_view(), name='payment-detail'),

    # Choice Options
    path('bookings/event-types/', EventTypeOptionListView.as_view(), name='event-type-list'),
    path('bookings/sources/', SourceOptionListView.as_view(), name='source-list'),
    path('bookings/service-styles/', ServiceStyleOptionListView.as_view(), name='service-style-list'),
    path('bookings/lead-statuses/', LeadStatusOptionListView.as_view(), name='lead-status-list'),
    path('bookings/settings/lead-statuses/', LeadStatusManageListCreateView.as_view(), name='lead-status-manage-list'),
    path('bookings/settings/lead-statuses/<int:pk>/', LeadStatusManageDetailView.as_view(), name='lead-status-manage-detail'),
    path('bookings/lost-reasons/', LostReasonOptionListView.as_view(), name='lost-reason-list'),
    path('bookings/meal-types/', MealTypeOptionListView.as_view(), name='meal-type-list'),

    # Choice-option management (Settings, manager/owner)
    path('bookings/settings/event-types/', EventTypeManageListCreateView.as_view(), name='event-type-manage-list'),
    path('bookings/settings/event-types/<int:pk>/', EventTypeManageDetailView.as_view(), name='event-type-manage-detail'),
    path('bookings/settings/sources/', SourceManageListCreateView.as_view(), name='source-manage-list'),
    path('bookings/settings/sources/<int:pk>/', SourceManageDetailView.as_view(), name='source-manage-detail'),
    path('bookings/settings/service-styles/', ServiceStyleManageListCreateView.as_view(), name='service-style-manage-list'),
    path('bookings/settings/service-styles/<int:pk>/', ServiceStyleManageDetailView.as_view(), name='service-style-manage-detail'),
    path('bookings/settings/meal-types/', MealTypeManageListCreateView.as_view(), name='meal-type-manage-list'),
    path('bookings/settings/meal-types/<int:pk>/', MealTypeManageDetailView.as_view(), name='meal-type-manage-detail'),
    path('bookings/settings/lost-reasons/', LostReasonManageListCreateView.as_view(), name='lost-reason-manage-list'),
    path('bookings/settings/lost-reasons/<int:pk>/', LostReasonManageDetailView.as_view(), name='lost-reason-manage-detail'),

    path('bookings/addon-products/', AddOnProductListView.as_view(), name='addon-product-list'),

    # WhatsApp
    path('bookings/leads/<int:lead_pk>/whatsapp/', WhatsAppMessageListView.as_view(), name='whatsapp-message-list'),
    path('bookings/leads/<int:lead_pk>/whatsapp/send/', WhatsAppSendView.as_view(), name='whatsapp-send'),
    path('bookings/leads/<int:lead_pk>/whatsapp/mark-read/', WhatsAppMarkReadView.as_view(), name='whatsapp-mark-read'),
    path('bookings/whatsapp/webhook/', TwilioWebhookView.as_view(), name='twilio-webhook'),

    # Locked Dates
    path('bookings/locked-dates/', LockedDateListCreateView.as_view(), name='locked-date-list'),
    path('bookings/locked-dates/<int:pk>/', LockedDateDeleteView.as_view(), name='locked-date-detail'),

    # Settings
    path('bookings/settings/', SiteSettingsView.as_view(), name='site-settings'),
]
