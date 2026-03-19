from django.urls import path

from bookings.views import (
    AccountListCreateView, AccountDetailView,
    ContactListCreateView, ContactDetailView,
    VenueListCreateView, VenueDetailView,
    UserListView, ProductLineListView, LeadListCreateView, LeadDetailView, LeadTransitionView, LeadCreateQuoteView, LeadWonView, LeadCreateEventView, LeadBulkUpdateView, LeadActivityView, LeadAutoAssignView, LeadKanbanView,
    DashboardStatsView,
    QuoteListCreateView, QuoteDetailView, QuoteTransitionView,
    QuoteLineItemListCreateView, QuoteLineItemDetailView,
    QuotePDFView,
    InvoiceListCreateView, InvoiceDetailView,
    PaymentListCreateView, PaymentDetailView,
    SiteSettingsView,
    EventTypeOptionListView, SourceOptionListView,
    ServiceStyleOptionListView, LeadStatusOptionListView,
    LostReasonOptionListView, MealTypeOptionListView,
    ArrangementTypeOptionListView,
    BeverageTypeOptionListView,
    ReminderListCreateView, ReminderDetailView,
    LeadReminderListCreateView, ReminderCountsView,
    WhatsAppMessageListView, WhatsAppSendView, TwilioWebhookView,
)

urlpatterns = [
    # Accounts & Contacts
    path('bookings/accounts/', AccountListCreateView.as_view(), name='account-list'),
    path('bookings/accounts/<int:pk>/', AccountDetailView.as_view(), name='account-detail'),
    path('bookings/accounts/<int:account_pk>/contacts/', ContactListCreateView.as_view(), name='contact-list'),
    path('bookings/accounts/<int:account_pk>/contacts/<int:pk>/', ContactDetailView.as_view(), name='contact-detail'),

    # Venues
    path('bookings/venues/', VenueListCreateView.as_view(), name='venue-list'),
    path('bookings/venues/<int:pk>/', VenueDetailView.as_view(), name='venue-detail'),

    # Users (for assignment dropdowns)
    path('bookings/users/', UserListView.as_view(), name='user-list'),

    # Product Lines & Leads
    path('bookings/product-lines/', ProductLineListView.as_view(), name='product-line-list'),
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
    path('bookings/lost-reasons/', LostReasonOptionListView.as_view(), name='lost-reason-list'),
    path('bookings/meal-types/', MealTypeOptionListView.as_view(), name='meal-type-list'),
    path('bookings/arrangement-types/', ArrangementTypeOptionListView.as_view(), name='arrangement-type-list'),
    path('bookings/beverage-types/', BeverageTypeOptionListView.as_view(), name='beverage-type-list'),

    # WhatsApp
    path('bookings/leads/<int:lead_pk>/whatsapp/', WhatsAppMessageListView.as_view(), name='whatsapp-message-list'),
    path('bookings/leads/<int:lead_pk>/whatsapp/send/', WhatsAppSendView.as_view(), name='whatsapp-send'),
    path('bookings/whatsapp/webhook/', TwilioWebhookView.as_view(), name='twilio-webhook'),

    # Settings
    path('bookings/settings/', SiteSettingsView.as_view(), name='site-settings'),
]
