from django.db import models


class Reminder(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('done', 'Done'),
        ('snoozed', 'Snoozed'),
        ('dismissed', 'Dismissed'),
    ]

    lead = models.ForeignKey(
        'bookings.Lead', on_delete=models.CASCADE, related_name='reminders',
    )
    user = models.ForeignKey(
        'users.User', on_delete=models.CASCADE, related_name='reminders',
    )
    due_at = models.DateTimeField()
    note = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    snoozed_until = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        'users.User', null=True, on_delete=models.SET_NULL,
        related_name='created_reminders',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_at']
        indexes = [
            models.Index(fields=['user', 'status', 'due_at']),
            models.Index(fields=['lead', 'status']),
        ]

    def __str__(self):
        return f"Reminder for {self.lead} – {self.due_at:%Y-%m-%d %H:%M}"
