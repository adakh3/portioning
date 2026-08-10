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
    QuoteMarkSharedWhatsAppView,
)
from .public_sign import (
    PublicBookingView, PublicBookingSignView, PublicBookingPDFView,
    QuoteSendForSignatureView, EventSendForSignatureView,
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
    TimelinePresetOptionListView,
    EventTypeManageListCreateView, EventTypeManageDetailView,
    SourceManageListCreateView, SourceManageDetailView,
    ServiceStyleManageListCreateView, ServiceStyleManageDetailView,
    MealTypeManageListCreateView, MealTypeManageDetailView,
    LostReasonManageListCreateView, LostReasonManageDetailView,
    TimelinePresetManageListCreateView, TimelinePresetManageDetailView,
)
from .addons import AddOnProductListView
from .reminders import (
    ReminderListCreateView, ReminderDetailView,
    LeadReminderListCreateView, ReminderCountsView,
)
from .whatsapp import WhatsAppMessageListView, WhatsAppSendView, WhatsAppMarkReadView, TwilioWebhookView
from .followups import (
    FollowUpDraftListView, LeadFollowUpDraftListView,
    FollowUpDraftApproveView, FollowUpDraftDismissView,
    FollowUpDraftBulkApproveView, FollowUpDraftCountView,
    FollowUpStatsView,
    CronRunFollowupsView,
    FollowUpPreviewView, FollowUpGenerateView,
    FollowUpDraftMarkSentView, LeadLogReplyView,
)
from .locked_dates import LockedDateListCreateView, LockedDateDeleteView
from .mailbox import (
    MailboxStatusView, MailboxConnectView, MailboxCallbackView, MailboxDisconnectView,
)
from .pricing import PricingPreviewView
