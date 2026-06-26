from .accounts import AccountListCreateView, AccountDetailView, ContactListCreateView, ContactDetailView, CustomerListCreateView, CustomerDetailView
from .venues import VenueListCreateView, VenueDetailView
from .leads import UserListView, ProductLineListView, ProductLineDetailView, ProductLineManageListCreateView, ProductLineManageDetailView, LeadListCreateView, LeadDetailView, LeadTransitionView, LeadConvertView, LeadCreateQuoteView, LeadWonView, LeadCreateEventView, LeadBulkUpdateView, LeadActivityView, LeadAutoAssignView, LeadKanbanView
from .dashboard import DashboardStatsView, MyDashboardStatsView
from .commission import (
    MyCommissionView,
    CommissionPlanManageListCreateView, CommissionPlanManageDetailView,
    CommissionBandManageListCreateView, CommissionBandManageDetailView,
    SalesTargetGridView, RepPlanManageView,
)
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
    LeadStatusManageListCreateView, LeadStatusManageDetailView,
    LostReasonOptionListView, MealTypeOptionListView,
    EventTypeManageListCreateView, EventTypeManageDetailView,
    SourceManageListCreateView, SourceManageDetailView,
    ServiceStyleManageListCreateView, ServiceStyleManageDetailView,
    MealTypeManageListCreateView, MealTypeManageDetailView,
    LostReasonManageListCreateView, LostReasonManageDetailView,
)
from .addons import AddOnProductListView
from .reminders import (
    ReminderListCreateView, ReminderDetailView,
    LeadReminderListCreateView, ReminderCountsView,
)
from .whatsapp import WhatsAppMessageListView, WhatsAppSendView, WhatsAppMarkReadView, TwilioWebhookView
from .locked_dates import LockedDateListCreateView, LockedDateDeleteView
