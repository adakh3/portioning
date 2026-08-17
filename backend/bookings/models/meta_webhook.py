"""Raw Meta webhook events, persisted before processing (REL-507).

Every webhook POST is written here the instant it arrives, *before* we try to
fetch the lead or route the message. That way a processing bug (or a transient
Graph API failure) can never lose an inquiry: the raw payload survives and the
hourly backfill / a reprocess can pick it up. `organisation` is nullable because
an event may arrive for a `page_id` no org has connected — we still record it
(and ignore it) rather than 4xx, which would make Meta retry and eventually
disable the subscription.
"""

from django.db import models

from users.managers import TenantManager
from users.model_mixins import OrgScopedModel

# Webhook change `field` values we recognise. leadgen is this ticket (REL-507);
# messages arrives with the conversation layer (REL-508) — the model already
# stores it so that's purely additive.
LEADGEN = 'leadgen'
MESSAGES = 'messages'


class MetaWebhookEvent(OrgScopedModel, models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', null=True, blank=True,
        on_delete=models.CASCADE, related_name='meta_webhook_events',
    )
    page_id = models.CharField(max_length=64, blank=True, default='', db_index=True)
    field = models.CharField(max_length=32, blank=True, default='')
    payload = models.JSONField(default=dict)

    received_at = models.DateTimeField(auto_now_add=True)
    # Set once the event has been handled; a row with received_at but no
    # processed_at is what the backfill/reprocess looks for.
    processed_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True, default='')

    class Meta:
        ordering = ['-received_at']
        indexes = [models.Index(fields=['processed_at'])]

    def __str__(self):
        return f'MetaWebhookEvent {self.field or "?"} page={self.page_id or "?"} #{self.pk}'


class MetaIngestedLead(OrgScopedModel, models.Model):
    """Idempotency ledger for Meta lead-ad submissions (REL-507).

    One row per (org, leadgen_id), written atomically the first time a submission
    is handled — whether it created a new Lead or merged into an existing one.
    Every later delivery (webhook retry, the hourly backfill re-seeing the same
    submission within Meta's 90-day window, or a race between the two) hits the
    unique constraint and is skipped. Without this the *merge* path had no marker,
    so the backfill re-logged a "new submission" activity on the matched lead
    every hour; and the unique constraint also closes the check-then-create race
    that could otherwise duplicate a Lead.
    """

    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='meta_ingested_leads',
    )
    leadgen_id = models.CharField(max_length=64)
    # The Lead this submission created or merged into (nullable belt-and-braces).
    lead = models.ForeignKey(
        'bookings.Lead', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='meta_ingested_refs',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'leadgen_id'], name='unique_org_meta_leadgen',
            ),
        ]

    def __str__(self):
        return f'MetaIngestedLead org={self.organisation_id} leadgen={self.leadgen_id}'
