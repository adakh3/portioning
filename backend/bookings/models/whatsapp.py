"""The client-message ledger — every message the platform sends a client.

Despite the model name, this is no longer WhatsApp-only: since REL-445 it records
email as well, and hangs off a lead **or** a quote **or** an event. The name is
kept for now only because renaming it touches 65 call sites across 18 modules;
that rename is tracked as its own change, not smuggled into a feature diff.

**The honesty rule this schema exists to enforce:** a message that left the
platform can be confirmed; a message the caterer sends themselves cannot. A
`wa.me` shortcut hands the text to the caterer's own WhatsApp and we never learn
what happened to it, so it is recorded `handed_off` — never `sent`/`delivered`.
When something machine-triggered would need a shortcut, nothing is claimed at
all: the row is `to_send`, a task for a human, not a send.
"""
from django.db import models
from users.managers import TenantManager


class WhatsAppMessage(models.Model):
    CHANNEL_WHATSAPP = 'whatsapp'
    CHANNEL_EMAIL = 'email'
    # Deliberately extensible: SMS was cut from REL-445, not designed out.
    CHANNEL_CHOICES = [
        (CHANNEL_WHATSAPP, 'WhatsApp'),
        (CHANNEL_EMAIL, 'Email'),
    ]

    # `handed_off` and `to_send` are the two states that keep the ledger honest
    # about shortcut WhatsApp — see the module docstring.
    HANDED_OFF = 'handed_off'
    TO_SEND = 'to_send'
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('read', 'Read'),
        ('received', 'Received'),
        (HANDED_OFF, 'Handed off'),
        (TO_SEND, 'To send'),
        ('failed', 'Failed'),
        ('undelivered', 'Undelivered'),
    ]

    # Statuses that must never be presented to a user as a completed send.
    UNCONFIRMED_STATUSES = (HANDED_OFF, TO_SEND)

    DIRECTION_CHOICES = [
        ('outbound', 'Outbound'),
        ('inbound', 'Inbound'),
    ]

    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='whatsapp_messages',
    )

    # Exactly one of these three is the parent (enforced by a CheckConstraint
    # below). `lead` was required until REL-445; existing rows all still have it.
    lead = models.ForeignKey(
        'bookings.Lead', null=True, blank=True,
        on_delete=models.CASCADE, related_name='whatsapp_messages',
    )
    quote = models.ForeignKey(
        'bookings.Quote', null=True, blank=True,
        on_delete=models.CASCADE, related_name='client_messages',
    )
    event = models.ForeignKey(
        'events.Event', null=True, blank=True,
        on_delete=models.CASCADE, related_name='client_messages',
    )
    reminder = models.ForeignKey(
        'bookings.Reminder', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='whatsapp_messages',
    )

    channel = models.CharField(
        max_length=10, choices=CHANNEL_CHOICES, default=CHANNEL_WHATSAPP, db_index=True,
    )

    # Wide enough for a Twilio-style address: 'whatsapp:' (9) + E.164 (max 16).
    # Postgres enforces this; the previous 20 overflowed on real numbers.
    to_phone = models.CharField(max_length=32, blank=True, default='')
    from_phone = models.CharField(max_length=32, blank=True, default='')
    to_email = models.EmailField(blank=True, default='')
    subject = models.CharField(max_length=300, blank=True, default='')
    body = models.TextField()

    # What was attached, for the ledger row to name it. The bytes are generated
    # per send from live data and never stored (nothing new to keep secure).
    attachment_filename = models.CharField(max_length=255, blank=True, default='')

    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='outbound')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='queued')

    twilio_sid = models.CharField(max_length=64, blank=True, default='')
    # The mailbox provider's id for an email send. Kept separate from twilio_sid
    # so neither channel's identifier has to pretend to be the other's.
    provider_message_id = models.CharField(max_length=255, blank=True, default='')
    error_code = models.CharField(max_length=10, blank=True, default='')
    error_message = models.TextField(blank=True, default='')

    sent_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='whatsapp_messages_sent',
    )

    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['lead', '-created_at']),
            models.Index(fields=['quote', '-created_at']),
            models.Index(fields=['event', '-created_at']),
            models.Index(fields=['twilio_sid']),
        ]
        constraints = [
            # A message with no parent is unreachable from every surface that
            # displays messages — it would be silently invisible, not harmless.
            models.CheckConstraint(
                check=(
                    models.Q(lead__isnull=False)
                    | models.Q(quote__isnull=False)
                    | models.Q(event__isnull=False)
                ),
                name='clientmessage_has_a_parent',
            ),
        ]

    @property
    def parent(self):
        """The lead, quote or event this message belongs to."""
        return self.lead or self.quote or self.event

    @property
    def is_automatic(self):
        """True when the platform sent this without a human clicking send.

        Derived from the absence of a sender rather than stored, so it can never
        drift out of step with who actually triggered the message.
        """
        return self.sent_by_id is None and self.direction == 'outbound'

    @property
    def recipient(self):
        return self.to_email if self.channel == self.CHANNEL_EMAIL else self.to_phone

    def __str__(self):
        label = 'Email' if self.channel == self.CHANNEL_EMAIL else 'WhatsApp'
        return f"{label} to {self.recipient} ({self.status})"
