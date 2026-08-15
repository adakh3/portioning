from django.db import models
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class FollowUpDraft(OrgScopedModel, models.Model):
    """An AI-drafted follow-up message awaiting human review.

    The agent only ever *drafts* — a draft becomes a real message to the client
    when a human approves it. Nothing is sent automatically.

    A draft is written for ONE channel, chosen when it is generated (see
    `followup_scheduler.choose_channel`), because the register differs: an email
    carries a subject and signs off, a WhatsApp message is two lines. The rep
    can still switch channel at send time — the wording survives, which is why
    `subject` is kept even on a draft that goes out over WhatsApp.
    """

    objects = TenantManager()

    STATUS_CHOICES = [
        ('pending', 'Pending review'),
        ('sent', 'Approved & sent'),
        ('dismissed', 'Dismissed'),
    ]
    # Mirrors WhatsAppMessage.CHANNEL_CHOICES — the ledger these drafts become.
    CHANNEL_CHOICES = [
        ('whatsapp', 'WhatsApp'),
        ('email', 'Email'),
    ]

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='followup_drafts',
    )
    lead = models.ForeignKey(
        'bookings.Lead', on_delete=models.CASCADE, related_name='followup_drafts',
    )
    # Existing rows predate email and stay on WhatsApp, which is also what they
    # were drafted as — hence the default rather than a backfill.
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default='whatsapp')
    subject = models.CharField(
        max_length=300, blank=True, default='',
        help_text='Email subject line. Empty for a WhatsApp draft, which has none.',
    )
    body = models.TextField(help_text='The drafted message the agent proposes to send.')
    reasoning = models.TextField(
        blank=True, default='',
        help_text='Short rationale the agent gave for this follow-up.',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    model_used = models.CharField(max_length=64, blank=True, default='')
    # Set when the draft is approved and dispatched. WhatsAppMessage is the
    # ledger for every client channel despite its name, so this one FK covers
    # email too — which is why the field's own name is now a lie. It was going
    # to be renamed `client_message`; that was dropped because renaming a column
    # has no safe deploy ordering (old code reads the old name, new code the
    # new one, and one of them is always wrong for the length of a rollout).
    # A misleading name is the cheaper of the two problems. See REL-501.
    whatsapp_message = models.ForeignKey(
        'bookings.WhatsAppMessage', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='followup_draft',
    )
    reviewed_by = models.ForeignKey(
        'users.User', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='reviewed_followup_drafts',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['organisation', 'status']),
            models.Index(fields=['lead', 'status']),
        ]

    def __str__(self):
        return f"Follow-up draft for {self.lead} ({self.status})"
