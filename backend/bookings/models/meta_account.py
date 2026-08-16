"""The org's connected Meta (Facebook/Instagram) assets (REL-506).

Two rows model one connection:

* ``MetaAccountConnection`` — one per org, holding the long-lived *user* access
  token from Facebook Login for Business. Page tokens are derived from it, so it
  is kept (encrypted) to re-derive them and to list the org's Pages during the
  connect picker without a fresh consent.
* ``ConnectedMetaPage`` — one per Page the org chose to connect, holding that
  Page's own long-lived access token (encrypted) and the id of any linked
  Instagram professional account.

Every token is Fernet ciphertext (see ``bookings/services/encryption.py``) and
is read/written only through the token properties — never serialized or logged
in plaintext, mirroring ``ConnectedMailbox``.
"""

from django.db import models

from bookings.services.encryption import decrypt, encrypt
from users.managers import TenantManager
from users.model_mixins import OrgScopedModel


class MetaAccountConnection(OrgScopedModel, models.Model):
    """An org's Meta authorisation — the long-lived user token behind its Pages.

    One per organisation. The user token is the credential from which every
    Page token is derived; it is never serialized or logged in plaintext.
    """

    objects = TenantManager()

    organisation = models.OneToOneField(
        'users.Organisation', on_delete=models.CASCADE, related_name='meta_connection',
    )

    # Fernet ciphertext — read/write through the user_access_token property.
    user_access_token_encrypted = models.TextField(blank=True, default='')
    # ~60 days out for a long-lived user token; kept so we can tell a stale
    # grant apart from a working one without a round trip.
    token_expires_at = models.DateTimeField(null=True, blank=True)

    connected_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='meta_connections',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Meta connection for org {self.organisation_id}'

    def __repr__(self):
        # Explicit so no change to Model.__repr__ can start echoing the token.
        return f'<MetaAccountConnection pk={self.pk} org={self.organisation_id}>'

    @property
    def user_access_token(self) -> str:
        return decrypt(self.user_access_token_encrypted) if self.user_access_token_encrypted else ''

    @user_access_token.setter
    def user_access_token(self, value: str):
        self.user_access_token_encrypted = encrypt(value) if value else ''


class ConnectedMetaPage(OrgScopedModel, models.Model):
    """A single Facebook Page the org connected, plus any linked IG account.

    Not a OneToOne: an org may connect several Pages. The Page access token is
    long-lived (it does not expire while the user token chain stays valid) and
    is stored encrypted; it is what later tickets use to pull leads and reply to
    DMs on this Page.
    """

    objects = TenantManager()

    organisation = models.ForeignKey(
        'users.Organisation', on_delete=models.CASCADE, related_name='connected_meta_pages',
    )
    connection = models.ForeignKey(
        MetaAccountConnection, on_delete=models.CASCADE, related_name='pages',
    )

    page_id = models.CharField(max_length=64)
    page_name = models.CharField(max_length=255)
    # The linked Instagram professional account, if the Page has one. Id is what
    # the Graph API keys off; the username is only for display.
    instagram_account_id = models.CharField(max_length=64, blank=True, default='')
    instagram_username = models.CharField(max_length=255, blank=True, default='')

    # Fernet ciphertext — read/write through the page_access_token property.
    page_access_token_encrypted = models.TextField(blank=True, default='')

    connected_by = models.ForeignKey(
        'users.User', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='connected_meta_pages',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # One row per Page per org: reconnecting the same Page updates in place.
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'page_id'], name='unique_org_meta_page',
            ),
        ]

    def __str__(self):
        return f'{self.page_name} ({self.page_id})'

    def __repr__(self):
        return f'<ConnectedMetaPage pk={self.pk} org={self.organisation_id} page={self.page_id}>'

    @property
    def page_access_token(self) -> str:
        return decrypt(self.page_access_token_encrypted) if self.page_access_token_encrypted else ''

    @page_access_token.setter
    def page_access_token(self, value: str):
        self.page_access_token_encrypted = encrypt(value) if value else ''
