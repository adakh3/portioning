from django.urls import path

from bookings.views import (
    AccountListCreateView, AccountDetailView,
    ContactListCreateView, ContactDetailView,
    VenueListCreateView, VenueDetailView,
    LeadListCreateView, LeadDetailView, LeadTransitionView, LeadConvertView,
    QuoteListCreateView, QuoteDetailView, QuoteTransitionView,
    QuoteLineItemListCreateView, QuoteLineItemDetailView,
    QuotePDFView,
    LaborRoleListCreateView, LaborRoleDetailView,
    StaffMemberListCreateView, StaffMemberDetailView,
    ShiftListCreateView, ShiftDetailView,
    EquipmentItemListCreateView, EquipmentItemDetailView,
    EquipmentReservationListCreateView, EquipmentReservationDetailView,
    InvoiceListCreateView, InvoiceDetailView,
    PaymentListCreateView, PaymentDetailView,
    BudgetRangeOptionListView, SiteSettingsView,
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

    # Leads
    path('bookings/leads/', LeadListCreateView.as_view(), name='lead-list'),
    path('bookings/leads/<int:pk>/', LeadDetailView.as_view(), name='lead-detail'),
    path('bookings/leads/<int:pk>/transition/', LeadTransitionView.as_view(), name='lead-transition'),
    path('bookings/leads/<int:pk>/convert/', LeadConvertView.as_view(), name='lead-convert'),

    # Quotes & Line Items
    path('bookings/quotes/', QuoteListCreateView.as_view(), name='quote-list'),
    path('bookings/quotes/<int:pk>/', QuoteDetailView.as_view(), name='quote-detail'),
    path('bookings/quotes/<int:pk>/transition/', QuoteTransitionView.as_view(), name='quote-transition'),
    path('bookings/quotes/<int:pk>/pdf/', QuotePDFView.as_view(), name='quote-pdf'),
    path('bookings/quotes/<int:quote_pk>/items/', QuoteLineItemListCreateView.as_view(), name='quote-item-list'),
    path('bookings/quotes/<int:quote_pk>/items/<int:pk>/', QuoteLineItemDetailView.as_view(), name='quote-item-detail'),

    # Staffing
    path('bookings/labor-roles/', LaborRoleListCreateView.as_view(), name='labor-role-list'),
    path('bookings/labor-roles/<int:pk>/', LaborRoleDetailView.as_view(), name='labor-role-detail'),
    path('bookings/staff/', StaffMemberListCreateView.as_view(), name='staff-list'),
    path('bookings/staff/<int:pk>/', StaffMemberDetailView.as_view(), name='staff-detail'),
    path('bookings/shifts/', ShiftListCreateView.as_view(), name='shift-list'),
    path('bookings/shifts/<int:pk>/', ShiftDetailView.as_view(), name='shift-detail'),

    # Equipment
    path('bookings/equipment/', EquipmentItemListCreateView.as_view(), name='equipment-list'),
    path('bookings/equipment/<int:pk>/', EquipmentItemDetailView.as_view(), name='equipment-detail'),
    path('bookings/equipment-reservations/', EquipmentReservationListCreateView.as_view(), name='equipment-reservation-list'),
    path('bookings/equipment-reservations/<int:pk>/', EquipmentReservationDetailView.as_view(), name='equipment-reservation-detail'),

    # Finance
    path('bookings/invoices/', InvoiceListCreateView.as_view(), name='invoice-list'),
    path('bookings/invoices/<int:pk>/', InvoiceDetailView.as_view(), name='invoice-detail'),
    path('bookings/invoices/<int:invoice_pk>/payments/', PaymentListCreateView.as_view(), name='payment-list'),
    path('bookings/invoices/<int:invoice_pk>/payments/<int:pk>/', PaymentDetailView.as_view(), name='payment-detail'),

    # Settings
    path('bookings/budget-ranges/', BudgetRangeOptionListView.as_view(), name='budget-range-list'),
    path('bookings/settings/', SiteSettingsView.as_view(), name='site-settings'),
]
