from datetime import timedelta

from django.db import models
from django.utils import timezone

from bookings.services.encryption import decrypt, encrypt
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class ConnectedMailbox(OrgScopedModel, models.Model):
    """The caterer's own mailbox, connected once via OAuth.

    Every client email the platform sends goes out through this account, so it
    arrives genuinely from the caterer's address and lands in their Sent folder.
    One mailbox per organisation; the refresh token is the credential to that
    mailbox and is never stored, serialized or logged in plaintext.
    """

    GOOGLE = 'google'
    MICROSOFT = 'microsoft'
    PROVIDER_CHOICES = [
        (GOOGLE, 'Google'),
        (MICROSOFT, 'Microsoft'),
    ]

    CONNECTED = 'connected'
    NEEDS_RECONNECT = 'needs_reconnect'
    STATUS_CHOICES = [
        (CONNECTED, 'Connected'),
        (NEEDS_RECONNECT, 'Needs reconnect'),
    ]

    objects = TenantManager()

    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='connected_mailbox',
    )

    provider = models.CharField(max_length=16, choices=PROVIDER_CHOICES)
    email_address = models.EmailField()

    # Fernet ciphertext — see bookings/services/encryption.py. Read/write these
    # through the refresh_token / access_token properties, never directly.
    refresh_token_encrypted = models.TextField(blank=True, default='')
    access_token_encrypted = models.TextField(blank=True, default='')
    access_token_expires_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=CONNECTED)
    # Why the connection broke, shown to the caterer next to the reconnect prompt.
    last_error = models.TextField(blank=True, default='')

    connected_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='connected_mailboxes',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = 'connected mailboxes'

    def __str__(self):
        return f'{self.email_address} ({self.get_provider_display()})'

    def __repr__(self):
        # Explicit, so no future change to Model.__repr__ can start echoing the
        # token fields into a traceback or a log line.
        return f'<ConnectedMailbox pk={self.pk} provider={self.provider} status={self.status}>'

    # ── Credentials ──

    @property
    def refresh_token(self) -> str:
        return decrypt(self.refresh_token_encrypted) if self.refresh_token_encrypted else ''

    @refresh_token.setter
    def refresh_token(self, value: str):
        self.refresh_token_encrypted = encrypt(value) if value else ''

    @property
    def access_token(self) -> str:
        return decrypt(self.access_token_encrypted) if self.access_token_encrypted else ''

    @access_token.setter
    def access_token(self, value: str):
        self.access_token_encrypted = encrypt(value) if value else ''

    @property
    def access_token_valid(self) -> bool:
        """True only if we hold an access token that isn't about to expire.

        The 60s margin stops a token that is technically still valid when we
        check it from expiring mid-flight on a slow send.
        """
        if not self.access_token_encrypted or not self.access_token_expires_at:
            return False
        return self.access_token_expires_at > timezone.now() + timedelta(seconds=60)

    def mark_needs_reconnect(self, error: str = ''):
        """Flip to the reconnect state and drop the dead access token."""
        self.status = self.NEEDS_RECONNECT
        self.last_error = (error or '')[:500]
        self.access_token_encrypted = ''
        self.access_token_expires_at = None
        self.save(update_fields=[
            'status', 'last_error', 'access_token_encrypted',
            'access_token_expires_at', 'updated_at',
        ])
