"""Client-facing e-signature: an unauthenticated, token-scoped surface where a
customer views a booking (a quote OR an event) and signs to confirm it.

Security model: there is no logged-in user, so these endpoints resolve the
booking by its unguessable ``public_token`` via the sanctioned cross-org bypass
(``Model.objects.unscoped()``) — the token itself is the authorisation. Only
customer-safe fields are ever returned (never ``internal_notes``).

Signing a quote runs the same ``accept_quote`` pipeline as the staff endpoint
(so the confirmed event is created identically); signing an event confirms it.
Each signature is an immutable snapshot (see ``BookingSignature``).
"""
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from bookings.pdf import generate_quote_pdf, generate_event_pdf
from users.mixins import get_org_object_or_404


# ── helpers ──────────────────────────────────────────────────────────────────

def _client_ip(request):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _booking_kind(booking):
    from bookings.models import Quote
    return 'quote' if isinstance(booking, Quote) else 'event'


def _resolve_booking(token):
    """Find a quote or event by public token (cross-org — the token is the key)."""
    from bookings.models import Quote
    from events.models import Event
    related = ('account', 'primary_contact', 'venue', 'organisation')
    prefetch = ('line_items', 'dishes__category', 'signatures',
                'additional_meals', 'additional_meals__dishes')
    quote = (Quote.objects.unscoped().select_related(*related)
             .prefetch_related(*prefetch).filter(public_token=token).first())
    if quote:
        return quote
    return (Event.objects.unscoped().select_related(*related)
            .prefetch_related(*prefetch).filter(public_token=token).first())


def _effective_signature(booking):
    """The signature is canonical on the EVENT (the enduring booking record). A
    quote's signed-state is therefore read from its event; a quote never keeps
    its own signature under the current flow."""
    if _booking_kind(booking) == 'quote':
        return booking.event.latest_signature if booking.event_id else booking.latest_signature
    return booking.latest_signature


def _is_signable(booking):
    """A live booking with no signature yet is always signable — including a
    quote already accepted by staff (the signature still lands on its event) and
    a quote past its validity date (there is no date-based link expiry). Only an
    explicitly killed booking is refused. The already-signed case is handled by
    the caller (idempotent)."""
    kind = _booking_kind(booking)
    if kind == 'quote':
        from bookings.models.quotes import QuoteStatus
        return booking.status not in (QuoteStatus.DECLINED, QuoteStatus.EXPIRED)
    from events.models import EventStatus
    return booking.status != EventStatus.CANCELLED


def _guest_count(booking):
    guests = getattr(booking, 'guest_count', None)
    if not guests:
        guests = (booking.gents or 0) + (booking.ladies or 0)
    return guests


def serialize_public_booking(booking):
    """Customer-safe view of a booking. Never exposes internal_notes or costs."""
    from bookings.models import OrgSettings
    kind = _booking_kind(booking)
    settings = OrgSettings.for_org(booking.organisation)

    # Menu grouped by dish category, in the org's display order
    groups = {}
    for dish in booking.dishes.all():
        cat = dish.category
        key = (cat.display_order, cat.display_name)
        groups.setdefault(key, []).append(dish.name)
    menu = [
        {'category': name, 'items': sorted(items)}
        for (_order, name), items in sorted(groups.items())
    ]

    line_items = [
        {
            'description': li.description,
            'category': li.get_category_display(),
            'quantity': str(li.quantity),
            'unit': li.get_unit_display(),
            'line_total': str(li.line_total),
        }
        for li in booking.line_items.all()
    ]

    # Additional meals (welcome drinks, second service…) — priced into the total,
    # so the client must see them before signing (parity with the PDF).
    additional_meals = [
        {
            'label': m.label,
            'guest_count': m.guest_count,
            'price_per_head': str(m.price_per_head) if m.price_per_head else None,
            'items': sorted(d.name for d in m.dishes.all()),
        }
        for m in booking.additional_meals.all()
    ]

    sig = _effective_signature(booking)
    # Address the person who receives and signs; a B2B account is shown alongside.
    customer = booking.primary_contact.name if booking.primary_contact_id else (
        booking.account.name if booking.account_id else None)

    return {
        'kind': kind,
        'reference': f"{'Quote' if kind == 'quote' else 'Event'} #{booking.pk}",
        'business_name': booking.organisation.name,
        'currency_symbol': settings.currency_symbol,
        'currency_code': settings.currency_code,
        'tax_label': settings.tax_label,
        'terms': settings.quotation_terms or '',
        'customer_name': customer,
        'event_date': booking.event_date.isoformat() if booking.event_date else None,
        'venue_name': booking.venue.name if booking.venue_id else None,
        'venue_address': booking.venue_address or '',
        'guest_count': _guest_count(booking),
        'gents': booking.gents or 0,
        'ladies': booking.ladies or 0,
        'event_type': booking.event_type or '',
        'meal_type': booking.meal_type or '',
        'service_style': booking.service_style or '',
        'menu': menu,
        'additional_meals': additional_meals,
        'line_items': line_items,
        'price_per_head': str(booking.price_per_head) if booking.price_per_head else None,
        'subtotal': str(booking.subtotal),
        'tax_rate': str(booking.tax_rate),
        'tax_amount': str(booking.tax_amount),
        'total': str(booking.total),
        'notes': booking.notes or '',
        'status': booking.status,
        'is_signed': sig is not None,
        'signable': sig is None and _is_signable(booking),
        'signer_name': sig.signer_name if sig else None,
        'signed_at': sig.signed_at.isoformat() if sig else None,
    }


def sign_booking(booking, *, signer_name, signer_email, signature_image, ip, user_agent):
    """Record an immutable signature and confirm the booking. For a quote this
    runs accept_quote (creating the confirmed event); for an event it flips
    TENTATIVE→CONFIRMED. Then freezes the signed PDF onto the signature."""
    from bookings.models import BookingSignature, OrgSettings
    kind = _booking_kind(booking)
    org_settings = OrgSettings.for_org(booking.organisation)

    # The signature always lands on the EVENT. Signing a quote ensures its
    # confirmed event exists (creating it, or reusing one staff already made);
    # signing an event confirms it. So a client signature is never lost, whatever
    # the booking's status was when they signed.
    if kind == 'quote':
        from bookings.services.quote_acceptance import accept_quote
        event = accept_quote(booking, user=None)
    else:
        from events.models import EventStatus
        event = booking
        if event.status == EventStatus.TENTATIVE:
            event.status = EventStatus.CONFIRMED
            if not event.booking_date:
                event.booking_date = timezone.now().date()
            event.save(update_fields=['status', 'booking_date'])

    sig = BookingSignature(
        event=event,
        signer_name=signer_name,
        signer_email=signer_email,
        signature_image=signature_image,
        consent_text=org_settings.quotation_terms or '',
        agreed_total=booking.total,  # what the client actually saw and agreed to
        agreed_guest_count=_guest_count(booking),
        currency_code=org_settings.currency_code,
        ip_address=ip,
        user_agent=user_agent,
    )
    sig.save()

    # Freeze exactly the document the client signed (the quote PDF if they signed
    # via a quote link, else the event PDF), stamped with the ACCEPTANCE block, so
    # later edits can't rewrite it and the signature is on the copy.
    pdf = (generate_quote_pdf(booking, signature=sig) if kind == 'quote'
           else generate_event_pdf(event, signature=sig))
    sig.signed_pdf = pdf
    sig.save(update_fields=['signed_pdf'])
    return sig


# ── public (unauthenticated, token-scoped) endpoints ─────────────────────────

class PublicBookingView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token):
        booking = _resolve_booking(token)
        if not booking:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_public_booking(booking))


class PublicBookingSignView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, token):
        booking = _resolve_booking(token)
        if not booking:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)

        # Idempotent: already signed → just return the signed state (v1 has no
        # re-sign). Checked via the event, so re-opening either the quote link or
        # the event link after signing can't create a second signature.
        if _effective_signature(booking):
            return Response(serialize_public_booking(booking))

        if not _is_signable(booking):
            return Response(
                {'error': 'This booking can no longer be signed.'},
                status=status.HTTP_409_CONFLICT,
            )

        signer_name = (request.data.get('signer_name') or '').strip()
        if not signer_name:
            return Response({'signer_name': 'Your name is required to sign.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not request.data.get('consent'):
            return Response({'consent': 'You must agree to the terms to sign.'},
                            status=status.HTTP_400_BAD_REQUEST)

        sign_booking(
            booking,
            signer_name=signer_name,
            signer_email=(request.data.get('signer_email') or '').strip(),
            signature_image=request.data.get('signature_image') or '',
            ip=_client_ip(request),
            user_agent=(request.META.get('HTTP_USER_AGENT') or '')[:2000],
        )
        booking.refresh_from_db()
        return Response(serialize_public_booking(booking), status=status.HTTP_201_CREATED)


class PublicBookingPDFView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, token):
        booking = _resolve_booking(token)
        if not booking:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        sig = _effective_signature(booking)
        if sig and sig.signed_pdf:
            pdf = bytes(sig.signed_pdf)
        elif _booking_kind(booking) == 'quote':
            pdf = generate_quote_pdf(booking, signature=sig)
        else:
            pdf = generate_event_pdf(booking, signature=sig)
        response = HttpResponse(pdf, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="booking-{booking.pk}.pdf"'
        return response


# ── staff endpoints: generate the client sign link ───────────────────────────

class QuoteSendForSignatureView(APIView):
    """POST /api/bookings/quotes/<pk>/send-for-signature/ — ensure a public
    token, move DRAFT→SENT, and return the token for the client link."""

    def post(self, request, pk):
        from bookings.models import Quote
        from bookings.models.quotes import QuoteStatus
        quote = get_org_object_or_404(Quote, request, pk=pk)
        quote.ensure_public_token()
        if quote.status == QuoteStatus.DRAFT:
            try:
                quote.transition_to(QuoteStatus.SENT)
            except ValueError:
                pass
        return Response({'public_token': str(quote.public_token), 'status': quote.status})


class EventSendForSignatureView(APIView):
    """POST /api/events/<pk>/send-for-signature/ — ensure a public token for a
    booking created directly as an event (no quote)."""

    def post(self, request, pk):
        from events.models import Event
        event = get_org_object_or_404(Event, request, pk=pk)
        event.ensure_public_token()
        return Response({'public_token': str(event.public_token), 'status': event.status})
