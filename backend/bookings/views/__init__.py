from .accounts import CustomerListCreateView, CustomerDetailView
from .venues import VenueListCreateView, VenueDetailView
from .leads import UserListView, ProductLineListView, LeadListCreateView, LeadDetailView, LeadTransitionView, LeadConvertView, LeadCreateQuoteView, LeadWonView, LeadCreateEventView, LeadBulkUpdateView, LeadActivityView, LeadAutoAssignView
from .dashboard import DashboardStatsView
from .quotes import (
    QuoteListCreateView, QuoteDetailView, QuoteTransitionView,
    QuoteLineItemListCreateView, QuoteLineItemDetailView,
    QuotePDFView,
)
from .finance import (
    InvoiceListCreateView, InvoiceDetailView,
    PaymentListCreateView, PaymentDetailView,
)
from .settings import SiteSettingsView
from .choices import (
    EventTypeOptionListView, SourceOptionListView,
    ServiceStyleOptionListView, LeadStatusOptionListView,
    LostReasonOptionListView,
)
from .reminders import (
    ReminderListCreateView, ReminderDetailView,
    LeadReminderListCreateView, ReminderCountsView,
)
