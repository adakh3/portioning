"""Send email as the caterer, through their own connected mailbox (REL-460).

This module is the whole contract the rest of the app needs::

    from bookings.services.email import send_via_mailbox, MailboxNotConnected

    message_id = send_via_mailbox(
        org, to='client@example.com', subject='Your quote',
        body='...', attachments=[('quote.pdf', pdf_bytes, 'application/pdf')],
    )

There is deliberately **no platform-address fallback**: if the org hasn't
connected a mailbox, the email channel simply isn't available and the caller
gets `MailboxNotConnected` to surface as "Connect your email".
"""

import logging
import uuid
from datetime import timedelta

from django.utils import timezone

from bookings.models import ConnectedMailbox
from bookings.services import mailbox_oauth

logger = logging.getLogger(__name__)


class MailboxError(Exception):
    """Base for every reason a send could not go out."""


class MailboxNotConnected(MailboxError):
    """The org has never connected a mailbox — the channel is unavailable."""


class MailboxNeedsReconnect(MailboxError):
    """The connection is dead (revoked, expired, scope withdrawn).

    The mailbox has already been flipped to `needs_reconnect` by the time this
    is raised, so Settings shows the reconnect prompt without further work.
    """


class MailboxSendFailed(MailboxError):
    """The provider refused this particular message. The connection is fine."""


# Captured sends when no real OAuth app is configured — the local-dev and CI
# equivalent of `django.core.mail.outbox`. Tests clear it in setUp.
outbox = []


def get_mailbox(org):
    """The org's connected mailbox, or None."""
    if org is None:
        return None
    return ConnectedMailbox.objects.for_org(org).first()


def mailbox_is_usable(org):
    """True when an email could actually be sent right now."""
    mailbox = get_mailbox(org)
    return bool(mailbox and mailbox.status == ConnectedMailbox.CONNECTED)


def send_via_mailbox(org, *, to, subject, body, attachments=None):
    """Send one email through the org's connected mailbox.

    `to` is an address or a list of them; `attachments` is a list of
    ``(filename, content_bytes, mimetype)`` triples — the same shape Django's
    own EmailMessage uses. Returns the provider's message id.
    """
    recipients = [to] if isinstance(to, str) else list(to)
    if not recipients:
        raise MailboxSendFailed('No recipient address.')

    mailbox = get_mailbox(org)
    if mailbox is None:
        raise MailboxNotConnected('No mailbox is connected for this organisation.')
    if mailbox.status != ConnectedMailbox.CONNECTED:
        raise MailboxNeedsReconnect(
            f'The connection to {mailbox.email_address} needs to be renewed.'
        )

    if not mailbox_oauth.provider_configured(mailbox.provider):
        return _fake_send(mailbox, recipients, subject, body, attachments)

    access_token = _ensure_access_token(mailbox)
    try:
        return mailbox_oauth.send_message(
            mailbox.provider, access_token,
            from_address=mailbox.email_address,
            to=recipients, subject=subject, body=body, attachments=attachments,
        )
    except mailbox_oauth.ProviderSendError as exc:
        if exc.auth_failed:
            # The grant died between the refresh and the send. Flip the mailbox
            # and stop — retrying can only fail the same way (AC5).
            mailbox.mark_needs_reconnect(str(exc))
            raise MailboxNeedsReconnect(
                f'The connection to {mailbox.email_address} is no longer authorised.'
            ) from exc
        raise MailboxSendFailed(str(exc)) from exc
    except Exception as exc:  # network error, DNS, timeout…
        logger.warning('Mailbox send failed for org %s: %s', getattr(org, 'pk', None), exc)
        raise MailboxSendFailed(str(exc)) from exc


def _ensure_access_token(mailbox):
    """Return a live access token, refreshing silently if needed (AC4)."""
    if mailbox.access_token_valid:
        return mailbox.access_token

    if not mailbox.refresh_token_encrypted:
        mailbox.mark_needs_reconnect('No refresh token stored.')
        raise MailboxNeedsReconnect(
            f'The connection to {mailbox.email_address} needs to be renewed.'
        )

    try:
        renewed = mailbox_oauth.refresh_access_token(
            mailbox.provider, mailbox.refresh_token,
        )
    except mailbox_oauth.OAuthExchangeError as exc:
        # invalid_grant is the caterer having revoked us; anything else could be
        # the provider having a bad day, so don't burn the connection for it.
        if mailbox_oauth.is_invalid_grant(exc):
            mailbox.mark_needs_reconnect(str(exc))
            raise MailboxNeedsReconnect(
                f'Access to {mailbox.email_address} was revoked. Please reconnect.'
            ) from exc
        raise MailboxSendFailed(f'Could not renew mailbox access: {exc}') from exc

    store_tokens(
        mailbox,
        access_token=renewed['access_token'],
        expires_in=renewed['expires_in'],
        refresh_token=renewed['refresh_token'],
    )
    return renewed['access_token']


def store_tokens(mailbox, *, access_token, expires_in, refresh_token=None):
    """Persist a fresh token set, clearing any previous failure."""
    mailbox.access_token = access_token
    mailbox.access_token_expires_at = timezone.now() + timedelta(seconds=expires_in)
    if refresh_token:
        mailbox.refresh_token = refresh_token
    mailbox.status = ConnectedMailbox.CONNECTED
    mailbox.last_error = ''
    mailbox.save(update_fields=[
        'access_token_encrypted', 'access_token_expires_at', 'refresh_token_encrypted',
        'status', 'last_error', 'updated_at',
    ])


def _fake_send(mailbox, recipients, subject, body, attachments):
    """Capture the send instead of making a network call (AC9).

    Active whenever the provider has no OAuth app configured — i.e. always in
    local dev and in CI, never in a deployment that has real credentials.
    """
    message_id = f'fake-{uuid.uuid4()}'
    outbox.append({
        'organisation_id': mailbox.organisation_id,
        'provider': mailbox.provider,
        'from': mailbox.email_address,
        'to': recipients,
        'subject': subject,
        'body': body,
        'attachments': list(attachments or []),
        'message_id': message_id,
        'sent_at': timezone.now(),
    })
    logger.info(
        'Fake mailbox transport captured a message to %s ("%s")', recipients, subject,
    )
    return message_id
