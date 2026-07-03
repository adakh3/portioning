from django.db import models
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class FollowUpDraft(OrgScopedModel, models.Model):
    """An AI-drafted follow-up message awaiting human review.

    The agent only ever *drafts* — a draft becomes a real WhatsApp message
    when a human approves it. Nothing is sent automatically.
    """

    objects = TenantManager()

    STATUS_CHOICES = [
        ('pending', 'Pending review'),
        ('sent', 'Approved & sent'),
        ('dismissed', 'Dismissed'),
    ]
    CHANNEL_CHOICES = [
        ('whatsapp', 'WhatsApp'),
    ]

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='followup_drafts',
    )
    lead = models.ForeignKey(
        'bookings.Lead', on_delete=models.CASCADE, related_name='followup_drafts',
    )
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default='whatsapp')
    body = models.TextField(help_text='The drafted message the agent proposes to send.')
    reasoning = models.TextField(
        blank=True, default='',
        help_text='Short rationale the agent gave for this follow-up.',
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    model_used = models.CharField(max_length=64, blank=True, default='')
    # Set when the draft is approved and dispatched.
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
