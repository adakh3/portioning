from django.db import models
from users.managers import TenantManager


class WhatsAppMessage(models.Model):
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('read', 'Read'),
        ('failed', 'Failed'),
        ('undelivered', 'Undelivered'),
    ]

    DIRECTION_CHOICES = [
        ('outbound', 'Outbound'),
        ('inbound', 'Inbound'),
    ]

    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='whatsapp_messages',
    )
    lead = models.ForeignKey(
        'bookings.Lead', on_delete=models.CASCADE, related_name='whatsapp_messages',
    )
    reminder = models.ForeignKey(
        'bookings.Reminder', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='whatsapp_messages',
    )

    to_phone = models.CharField(max_length=20)
    from_phone = models.CharField(max_length=20)
    body = models.TextField()

    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES, default='outbound')
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default='queued')

    twilio_sid = models.CharField(max_length=64, blank=True, default='')
    error_code = models.CharField(max_length=10, blank=True, default='')
    error_message = models.TextField(blank=True, default='')

    sent_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='whatsapp_messages_sent',
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['lead', '-created_at']),
            models.Index(fields=['twilio_sid']),
        ]

    def __str__(self):
        return f"WhatsApp to {self.to_phone} ({self.status})"
