from django.db import models
from users.managers import TenantManager


class LockedDate(models.Model):
    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='locked_dates',
    )
    date = models.DateField(db_index=True)
    reason = models.CharField(max_length=255, blank=True, default='')
    locked_by = models.ForeignKey(
        'users.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='locked_dates',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['date']
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'date'],
                name='unique_locked_date_per_org',
            ),
        ]

    def __str__(self):
        return f"Locked: {self.date}"
